const { app, BrowserWindow } = require('electron')
const { execFileSync, spawn } = require('node:child_process')
const { join, resolve, dirname } = require('node:path')
const { randomUUID } = require('node:crypto')
const { performance } = require('node:perf_hooks')
const fs = require('node:fs')
const { PcmReader } = require('../pcm-reader.cjs')

const ROOT = resolve(__dirname, '..', '..')
const PRISM = join(ROOT, 'upstream', 'prism')
const config = JSON.parse(process.env.PHASE1_JOB || '{}')
const FPS = 30
const native = require(join(PRISM, 'native', 'build', 'Release', 'visualizer_dsp.node')).vectorscope

function probe(input) {
  let raw
  try {
    raw = execFileSync('ffprobe', [
      '-v', 'error', '-show_entries', 'stream=codec_type,channels,sample_rate,duration:format=duration',
      '-of', 'json', input,
    ], { encoding: 'utf8', maxBuffer: 1024 * 1024 })
  } catch (error) {
    throw new Error(`Could not read audio metadata: ${error.stderr?.toString().trim() || error.message}`)
  }
  const data = JSON.parse(raw)
  const stream = data.streams?.find(value => value.codec_type === 'audio')
  if (!stream) throw new Error('Input has no audio stream')
  const channels = Number(stream.channels)
  if (channels !== 1 && channels !== 2) throw new Error(`Only mono or stereo audio is supported (found ${channels} channels)`)
  const sampleRate = Number(stream.sample_rate)
  if (!Number.isSafeInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000) {
    throw new Error(`Unsupported sample rate: ${stream.sample_rate}`)
  }
  const duration = Number(stream.duration || data.format?.duration)
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('Input duration is unavailable or invalid')
  return { channels, sampleRate, duration }
}

function startEncoder(temp, input) {
  const args = [
    '-nostdin', '-hide_banner', '-loglevel', 'error', '-n',
    '-f', 'image2pipe', '-framerate', String(FPS), '-vcodec', 'png', '-i', 'pipe:0',
    '-i', input, '-map', '0:v:0', '-map', '1:a:0',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
    '-pix_fmt', 'yuv420p', '-r', String(FPS),
    '-frames:v', String(Math.ceil(config.duration * FPS)),
    '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', temp,
  ]
  const child = spawn('ffmpeg', args, { stdio: ['pipe', 'ignore', 'pipe'], shell: false })
  let errors = ''
  child.stderr.on('data', chunk => { errors = (errors + chunk.toString()).slice(-8192) })
  child.stdin.on('error', () => {})
  const done = new Promise((resolveDone, reject) => {
    child.once('error', reject)
    child.once('close', code => code === 0
      ? resolveDone()
      : reject(new Error(`Video encoder exited ${code}: ${errors}`)))
  })
  done.catch(() => {})
  return { child, done }
}

function checkCancel(frame) {
  if (fs.existsSync(config.cancelFile) || (config.cancelAfterFrames && frame >= config.cancelAfterFrames)) {
    throw new Error('Export cancelled')
  }
}

function electronWorkingSetKiB() {
  return app.getAppMetrics().reduce((total, metric) => total + (metric.memory?.workingSetSize || 0), 0)
}

async function writeFrame(encoder, png) {
  if (encoder.child.stdin.destroyed) throw new Error('Encoder input closed unexpectedly')
  if (encoder.child.stdin.write(png)) return
  await new Promise((resolveDrain, reject) => {
    const cleanup = () => {
      encoder.child.stdin.off('drain', onDrain)
      encoder.child.stdin.off('error', onError)
      encoder.child.off('close', onClose)
    }
    const onDrain = () => { cleanup(); resolveDrain() }
    const onError = error => { cleanup(); reject(error) }
    const onClose = code => { cleanup(); reject(new Error(`Encoder exited while waiting for frame data (${code})`)) }
    encoder.child.stdin.once('drain', onDrain)
    encoder.child.stdin.once('error', onError)
    encoder.child.once('close', onClose)
  })
}

async function exportVideo() {
  const metadata = probe(config.input)
  config.duration = metadata.duration
  const totalFrames = Math.ceil(metadata.duration * FPS)
  const temp = `${config.output}.partial-${randomUUID()}.mp4`
  fs.mkdirSync(dirname(config.output), { recursive: true })
  const reader = new PcmReader(config.input, metadata.sampleRate)
  let encoder
  let win
  let success = false
  const started = performance.now()
  let analyzeMs = 0
  let renderMs = 0
  let backpressureMs = 0
  let peakRss = process.memoryUsage().rss
  let peakElectronWorkingSetKiB = electronWorkingSetKiB()
  let decodedFrames = 0
  let renderedFrames = 0
  try {
    win = new BrowserWindow({
      show: false, width: config.width, height: config.height,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
    })
    await win.loadFile(join(__dirname, 'index.html'))
    const ready = await win.webContents.executeJavaScript('typeof window.phase1?.initialize')
    if (ready !== 'function') throw new Error('Offline renderer failed to initialize')
    await win.webContents.executeJavaScript(
      `window.phase1.initialize(${config.width},${config.height},${JSON.stringify(config.title)},${FPS})`,
    )
    native.reset()
    native.setSampleRate(metadata.sampleRate)
    encoder = startEncoder(temp, config.input)
    console.log(JSON.stringify({ event: 'started', input: config.input, output: config.output, ...metadata, totalFrames, encoderPid: encoder.child.pid, decoderPid: reader.child.pid }))

    for (let index = 0; index < totalFrames; index++) {
      checkCancel(index)
      const nextSample = Math.min(Math.floor((index + 1) * metadata.sampleRate / FPS), Math.ceil(metadata.duration * metadata.sampleRate))
      const wanted = Math.max(0, nextSample - decodedFrames)
      const analysisStart = performance.now()
      const pcm = await reader.readFrames(wanted)
      if (pcm.frames === 0 && index < totalFrames - 1) throw new Error(`Decoder ended early at frame ${index}`)
      if (pcm.frames > 0) native.pushSamples(pcm.left, pcm.right)
      decodedFrames += pcm.frames
      const result = native.getPoints(1024)
      analyzeMs += performance.now() - analysisStart
      const x = Buffer.from(result.x.buffer, result.x.byteOffset, result.count * 4).toString('base64')
      const y = Buffer.from(result.y.buffer, result.y.byteOffset, result.count * 4).toString('base64')
      const renderStart = performance.now()
      const encoded = await win.webContents.executeJavaScript(`window.phase1.render(${JSON.stringify(x)},${JSON.stringify(y)},${index})`)
      renderMs += performance.now() - renderStart
      const png = Buffer.from(encoded, 'base64')
      const backpressureStart = performance.now()
      await writeFrame(encoder, png)
      backpressureMs += performance.now() - backpressureStart
      renderedFrames++
      peakRss = Math.max(peakRss, process.memoryUsage().rss)
      if (renderedFrames % 30 === 0 || renderedFrames === totalFrames) {
        const electronWorkingSet = electronWorkingSetKiB()
        peakElectronWorkingSetKiB = Math.max(peakElectronWorkingSetKiB, electronWorkingSet)
        console.log(JSON.stringify({ event: 'progress', frames: renderedFrames, totalFrames,
          seconds: renderedFrames / FPS, electronWorkingSetKiB: electronWorkingSet }))
      }
      checkCancel(renderedFrames)
    }
    encoder.child.stdin.end()
    await encoder.done
    if (fs.existsSync(config.output)) throw new Error(`Output appeared during export: ${config.output}`)
    fs.renameSync(temp, config.output)
    success = true
    console.log(JSON.stringify({
      event: 'finished', output: config.output, frames: renderedFrames, decodedFrames,
      elapsedSeconds: (performance.now() - started) / 1000,
      analyzeSeconds: analyzeMs / 1000, renderSeconds: renderMs / 1000,
      encoderBackpressureSeconds: backpressureMs / 1000, peakMainRssBytes: peakRss,
      peakElectronWorkingSetKiB,
    }))
  } finally {
    if (!success) {
      if (encoder) {
        console.error(JSON.stringify({ event: 'cleanup', stage: 'encoder-stop' }))
        encoder.child.stdin.destroy()
        if (encoder.child.exitCode === null) encoder.child.kill()
        await encoder.done.catch(() => {})
        console.error(JSON.stringify({ event: 'cleanup', stage: 'encoder-stopped' }))
      }
      fs.rmSync(temp, { force: true })
    }
    console.error(JSON.stringify({ event: 'cleanup', stage: 'decoder-stop' }))
    try {
      await reader.close()
      console.error(JSON.stringify({ event: 'cleanup', stage: 'decoder-stopped' }))
    } finally {
      win?.destroy()
    }
  }
}

app.disableHardwareAcceleration()
app.whenReady().then(exportVideo).then(() => app.quit()).catch(error => {
  console.error(JSON.stringify({ event: 'failed', message: error.message }))
  app.exit(error.message === 'Export cancelled' ? 2 : 1)
})

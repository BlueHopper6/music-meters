const { app, BrowserWindow } = require('electron')
const { spawn } = require('node:child_process')
const { join, resolve, dirname, extname } = require('node:path')
const { randomUUID } = require('node:crypto')
const { performance } = require('node:perf_hooks')
const fs = require('node:fs')
const { PcmReader } = require('../../phase1/pcm-reader.cjs')
const { normalizeProject } = require('../project.cjs')
const { probeAudio } = require('../audio.cjs')
const { precomputeSpectra } = require('../../phase3/spectrum.cjs')
const { precomputeOscilloscopes } = require('../../phase3/oscilloscope.cjs')
const { precomputeSpectrograms } = require('../../phase3/spectrogram.cjs')
const { precomputeWaveforms } = require('../../phase3/waveform.cjs')

const ROOT = resolve(__dirname, '..', '..')
const PRISM = join(ROOT, 'upstream', 'prism')
const nativeModule = require(join(PRISM, 'native', 'build', 'Release', 'visualizer_dsp.node'))
const native = nativeModule.vectorscope
const nativeSpectrum = nativeModule.spectrum
const nativeOscilloscope = nativeModule.oscilloscope
const nativeSpectrogram = nativeModule.spectrogram
const nativeWaveform = nativeModule.waveform
const config = JSON.parse(process.env.PHASE2_JOB || '{}')
const FPS = 30

function validate() {
  const project = normalizeProject(config.project)
  if (!project.audioPath || !fs.statSync(project.audioPath).isFile()) throw new Error('Project audio is unavailable')
  if (typeof config.output !== 'string' || extname(config.output).toLowerCase() !== '.mp4') {
    throw new Error('Output must be an MP4 path')
  }
  if (fs.existsSync(config.output)) throw new Error(`Output already exists: ${config.output}`)
  if (typeof config.cancelFile !== 'string') throw new Error('Missing cancellation marker path')
  if (!['720p', '1080p'].includes(config.preset)) throw new Error('Unsupported export preset')
  return project
}

function startEncoder(temp, input, totalFrames) {
  const args = [
    '-nostdin', '-hide_banner', '-loglevel', 'error', '-n',
    '-f', 'image2pipe', '-framerate', String(FPS), '-vcodec', 'png', '-i', 'pipe:0',
    '-i', input, '-map', '0:v:0', '-map', '1:a:0',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
    '-pix_fmt', 'yuv420p', '-r', String(FPS), '-frames:v', String(totalFrames),
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

function checkCancel(frame) {
  if (fs.existsSync(config.cancelFile) || (config.cancelAfterFrames && frame >= config.cancelAfterFrames)) {
    throw new Error('Export cancelled')
  }
}

async function exportVideo() {
  const project = validate()
  const metadata = probeAudio(project.audioPath)
  const totalFrames = metadata.totalFrames
  const [width, height] = config.preset === '1080p' ? [1920, 1080] : [1280, 720]
  const temp = `${config.output}.partial-${randomUUID()}.mp4`
  fs.mkdirSync(dirname(config.output), { recursive: true })
  const spectrumDirectory = join(ROOT, 'artifacts', 'phase3', 'jobs', randomUUID())
  const oscilloscopeDirectory = join(ROOT, 'artifacts', 'phase3', 'jobs', randomUUID())
  const spectrogramDirectory = join(ROOT, 'artifacts', 'phase3', 'jobs', randomUUID())
  const waveformDirectory = join(ROOT, 'artifacts', 'phase3', 'jobs', randomUUID())
  let spectrumCache
  let oscilloscopeCache
  let spectrogramCache
  let waveformCache
  let reader
  let encoder
  let win
  let success = false
  const started = performance.now()
  let analyzeMs = 0
  let renderMs = 0
  let backpressureMs = 0
  let peakMainRss = process.memoryUsage().rss
  let decodedFrames = 0
  let renderedFrames = 0
  try {
    spectrumCache = await precomputeSpectra(project.audioPath, metadata, project, nativeSpectrum,
      spectrumDirectory, () => !fs.existsSync(config.cancelFile),
      (configuration, configurations, frames, total) => console.log(JSON.stringify({
        event: 'analysis-progress', configuration, configurations, frames, total,
      })))
    oscilloscopeCache = await precomputeOscilloscopes(project.audioPath, metadata, project, nativeOscilloscope,
      oscilloscopeDirectory, () => !fs.existsSync(config.cancelFile),
      (frames, total) => console.log(JSON.stringify({ event: 'oscilloscope-progress', frames, total })))
    spectrogramCache = await precomputeSpectrograms(project.audioPath, metadata, project, nativeSpectrogram,
      spectrogramDirectory, width / project.width, () => !fs.existsSync(config.cancelFile),
      (configuration, configurations, frames, total) => console.log(JSON.stringify({
        event: 'spectrogram-progress', configuration, configurations, frames, total })))
    waveformCache = await precomputeWaveforms(project.audioPath, metadata, project, nativeWaveform,
      waveformDirectory, width / project.width, () => !fs.existsSync(config.cancelFile),
      (configuration, configurations, frames, total) => console.log(JSON.stringify({
        event: 'waveform-progress', configuration, configurations, frames, total })))
    reader = new PcmReader(project.audioPath, metadata.sampleRate)
    win = new BrowserWindow({ show: false, width, height,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true,
        backgroundThrottling: false } })
    await win.loadFile(join(__dirname, 'index.html'))
    const ready = await win.webContents.executeJavaScript('typeof window.phase2Export?.initialize')
    if (ready !== 'function') throw new Error('Offline composition failed to initialize')
    await win.webContents.executeJavaScript(
      `window.phase2Export.initialize(${JSON.stringify(project)},${width},${height},${metadata.sampleRate})`)
    native.reset()
    native.setSampleRate(metadata.sampleRate)
    encoder = startEncoder(temp, project.audioPath, totalFrames)
    console.log(JSON.stringify({ event: 'started', input: project.audioPath, output: config.output,
      ...metadata, width, height, encoderPid: encoder.child.pid, decoderPid: reader.child.pid }))
    for (let index = 0; index < totalFrames; index++) {
      checkCancel(index)
      const nextSample = Math.min(Math.floor((index + 1) * metadata.sampleRate / FPS),
        Math.ceil(metadata.duration * metadata.sampleRate))
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
      const spectra = spectrumCache.frame()
      const oscilloscopes = oscilloscopeCache.frame()
      const spectrograms = spectrogramCache.frame()
      const waveforms = waveformCache.frame()
      const encoded = await win.webContents.executeJavaScript(`window.phase2Export.render(${JSON.stringify(x)},${JSON.stringify(y)},${JSON.stringify(spectra)},${JSON.stringify(oscilloscopes)},${JSON.stringify(spectrograms)},${JSON.stringify(waveforms)},${index})`)
      renderMs += performance.now() - renderStart
      const png = Buffer.from(encoded, 'base64')
      const backpressureStart = performance.now()
      await writeFrame(encoder, png)
      backpressureMs += performance.now() - backpressureStart
      renderedFrames++
      peakMainRss = Math.max(peakMainRss, process.memoryUsage().rss)
      if (renderedFrames % 30 === 0 || renderedFrames === totalFrames) {
        console.log(JSON.stringify({ event: 'progress', frames: renderedFrames,
          totalFrames, seconds: renderedFrames / FPS }))
      }
      checkCancel(renderedFrames)
    }
    encoder.child.stdin.end()
    await encoder.done
    if (fs.existsSync(config.output)) throw new Error(`Output appeared during export: ${config.output}`)
    fs.renameSync(temp, config.output)
    success = true
    console.log(JSON.stringify({ event: 'finished', output: config.output, frames: renderedFrames,
      decodedFrames, elapsedSeconds: (performance.now() - started) / 1000,
      analyzeSeconds: analyzeMs / 1000, renderSeconds: renderMs / 1000,
      encoderBackpressureSeconds: backpressureMs / 1000, peakMainRssBytes: peakMainRss }))
  } finally {
    if (!success) {
      if (encoder) {
        encoder.child.stdin.destroy()
        if (encoder.child.exitCode === null) encoder.child.kill()
        await encoder.done.catch(() => {})
      }
      fs.rmSync(temp, { force: true })
    }
    try { await reader?.close() } finally { spectrumCache?.close(); oscilloscopeCache?.close(); spectrogramCache?.close(); waveformCache?.close(); win?.destroy() }
  }
}

app.disableHardwareAcceleration()
app.whenReady().then(exportVideo).then(() => app.quit()).catch(error => {
  console.error(error.message)
  app.exit(error.message === 'Export cancelled' ? 2 : 1)
})

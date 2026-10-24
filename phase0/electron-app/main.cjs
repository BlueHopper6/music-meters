const { app, BrowserWindow } = require('electron')
const { execFileSync, spawn } = require('node:child_process')
const { join, resolve, dirname } = require('node:path')
const { once } = require('node:events')
const { performance } = require('node:perf_hooks')
const fs = require('node:fs')

const root = resolve(__dirname, '..', '..')
const prism = join(root, 'upstream', 'prism')
const fixture = process.env.PHASE0_FIXTURE
const output = process.env.PHASE0_OUTPUT
const ffmpeg = process.env.PHASE0_FFMPEG || 'ffmpeg'
const FPS = 30
const RATE = 48000
const FRAMES = 9 * FPS
const SAMPLES_PER_FRAME = RATE / FPS
const native = require(join(prism, 'native', 'build', 'Release', 'visualizer_dsp.node')).vectorscope

function decode() {
  const bytes = execFileSync(ffmpeg, [
    '-v', 'error', '-i', fixture, '-f', 'f32le', '-acodec', 'pcm_f32le',
    '-ac', '2', '-ar', String(RATE), 'pipe:1',
  ], { maxBuffer: 16 * 1024 * 1024 })
  if (bytes.length !== FRAMES * SAMPLES_PER_FRAME * 2 * 4) {
    throw new Error(`Unexpected decoded PCM length: ${bytes.length}`)
  }
  return bytes
}

function encoder() {
  const args = [
    '-hide_banner', '-loglevel', 'error', '-n',
    '-f', 'image2pipe', '-framerate', String(FPS), '-vcodec', 'png', '-i', 'pipe:0',
    '-i', fixture, '-map', '0:v:0', '-map', '1:a:0',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18',
    '-pix_fmt', 'yuv420p', '-r', String(FPS), '-frames:v', String(FRAMES),
    '-c:a', 'aac', '-b:a', '192k', '-t', '9', '-movflags', '+faststart', output,
  ]
  const child = spawn(ffmpeg, args, { stdio: ['pipe', 'ignore', 'pipe'], shell: false })
  let errors = ''
  child.stderr.on('data', chunk => { errors += chunk.toString() })
  const done = new Promise((resolveDone, reject) => {
    child.on('error', reject)
    child.on('close', code => code === 0 ? resolveDone() : reject(new Error(`FFmpeg exit ${code}: ${errors}`)))
  })
  return { child, done }
}

async function run() {
  app.disableHardwareAcceleration()
  await app.whenReady()
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 720,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
  })
  await win.loadFile(join(__dirname, 'index.html'))
  const ready = await win.webContents.executeJavaScript('typeof window.phase0?.draw')
  if (ready !== 'function') throw new Error('Renderer did not initialize')
  const pcm = decode()
  native.reset()
  native.setSampleRate(RATE)
  fs.mkdirSync(dirname(output), { recursive: true })
  const encode = encoder()
  const start = performance.now()
  let peakRss = process.memoryUsage().rss
  try {
    for (let frame = 0; frame < FRAMES; frame++) {
      const left = new Float32Array(SAMPLES_PER_FRAME)
      const right = new Float32Array(SAMPLES_PER_FRAME)
      const offset = frame * SAMPLES_PER_FRAME * 8
      for (let sample = 0; sample < SAMPLES_PER_FRAME; sample++) {
        left[sample] = pcm.readFloatLE(offset + sample * 8)
        right[sample] = pcm.readFloatLE(offset + sample * 8 + 4)
      }
      native.pushSamples(left, right)
      const result = native.getPoints(1024)
      const script = `window.phase0.draw(${JSON.stringify(Array.from(result.x))},${JSON.stringify(Array.from(result.y))},${frame})`
      const pngBase64 = await win.webContents.executeJavaScript(script)
      const png = Buffer.from(pngBase64, 'base64')
      if ([45, 135, 225].includes(frame)) {
        fs.writeFileSync(join(dirname(output), `frame-${String(frame).padStart(3, '0')}.png`), png)
      }
      if (!encode.child.stdin.write(png)) await once(encode.child.stdin, 'drain')
      peakRss = Math.max(peakRss, process.memoryUsage().rss)
      if ((frame + 1) % 30 === 0) console.log(`rendered ${frame + 1}/${FRAMES}`)
    }
    encode.child.stdin.end()
    await encode.done
    console.log(JSON.stringify({ output, elapsedSeconds: (performance.now() - start) / 1000, peakMainRssBytes: peakRss, frames: FRAMES }))
  } catch (error) {
    encode.child.stdin.destroy()
    encode.child.kill()
    await encode.done.catch(() => {})
    throw error
  } finally {
    win.destroy()
  }
}

run().then(() => app.quit()).catch(error => { console.error(error); app.exit(1) })

const { app, BrowserWindow } = require('electron')
const { spawn } = require('node:child_process')
const { join, resolve, dirname } = require('node:path')
const { randomUUID } = require('node:crypto')
const { performance } = require('node:perf_hooks')
const fs = require('node:fs')
const { jobPath } = require('../runtime.cjs')
// Managed launchers remove this profile after the process exits. Direct test
// launches get unique temporary profiles, retained with their test evidence.
let exportProfile = process.env.MUSICMETERS_EXPORT_PROFILE
if (!exportProfile) {
  const profileRoot = process.env.PHASE5_TEST_USER_DATA || jobPath('export-test-profiles')
  fs.mkdirSync(profileRoot, { recursive: true })
  exportProfile = fs.mkdtempSync(join(profileRoot, 'export-'))
}
app.setPath('userData', exportProfile)
app.setPath('sessionData', exportProfile)
const { assertOutputSpace } = require('../space.cjs')
const { PcmReader } = require('../../phase1/pcm-reader.cjs')
const { normalizeProject } = require('../project.cjs')
const { assertInstalledFonts } = require('../fonts.cjs')
const { assetData } = require('../assets.cjs')
const { probeAudio } = require('../audio.cjs')
const { outputFormat, aacBitrate, validateOutputPath, validateAudioCopy } = require('../audio-output.cjs')
const { lockWindowNavigation } = require('../window-security.cjs')
const { precomputeSpectra } = require('../../phase3/spectrum.cjs')
const { precomputeOscilloscopes } = require('../../phase3/oscilloscope.cjs')
const { precomputeSpectrograms } = require('../../phase3/spectrogram.cjs')
const { precomputeWaveforms } = require('../../phase3/waveform.cjs')
const { precomputeVus } = require('../../phase3/vu.cjs')
const { precomputeLoudness } = require('../../phase3/loudness.cjs')
const { precomputeWaterfalls } = require('../../phase3/waterfall.cjs')

const ROOT = resolve(__dirname, '..', '..')
const PRISM = join(ROOT, 'upstream', 'prism')
const nativeModule = require(join(PRISM, 'native', 'build', 'Release', 'visualizer_dsp.node'))
const native = nativeModule.vectorscope
const nativeSpectrum = nativeModule.spectrum
const nativeOscilloscope = nativeModule.oscilloscope
const nativeSpectrogram = nativeModule.spectrogram
const nativeWaveform = nativeModule.waveform
const nativeVu = nativeModule.vumeter
const nativeLoudness = nativeModule.lufsmeter
const nativeWaterfall = nativeModule.waterfall
const config = JSON.parse(process.env.PHASE2_JOB || '{}')
const FPS = 30

function validate() {
  const project = normalizeProject(config.project)
  assertInstalledFonts(project)
  if (!project.audioPath || !fs.statSync(project.audioPath).isFile()) throw new Error('Project audio is unavailable')
  validateOutputPath(config.output, config.audioMode)
  if (fs.existsSync(config.output)) throw new Error(`Output already exists: ${config.output}`)
  if (typeof config.cancelFile !== 'string') throw new Error('Missing cancellation marker path')
  if (!['720p', '1080p'].includes(config.preset)) throw new Error('Unsupported export preset')
  return project
}

function startEncoder(temp, input, totalFrames, audioMode, metadata) {
  const audioBitrate = audioMode === 'copy' ? null : aacBitrate(metadata)
  const audioArgs = audioMode === 'copy' ? ['-c:a', 'copy']
    : ['-c:a', 'aac', '-b:a', audioBitrate, '-movflags', '+faststart']
  const args = [
    '-nostdin', '-hide_banner', '-loglevel', 'error', '-n',
    '-f', 'image2pipe', '-framerate', String(FPS), '-vcodec', 'png', '-i', 'pipe:0',
    '-i', input, '-map', '0:v:0', '-map', '1:a:0',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
    '-pix_fmt', 'yuv420p', '-r', String(FPS),
    ...(audioMode === 'copy' ? [] : ['-frames:v', String(totalFrames)]),
    ...audioArgs, temp,
  ]
  const child = spawn(process.env.PHASE6_TEST_ENCODER || 'ffmpeg', args,
    { stdio: ['pipe', 'ignore', 'pipe'], shell: false })
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
  return { child, done, audioBitrate }
}

async function writeFrame(encoder, png) {
  if (encoder.child.stdin.destroyed) throw new Error('Encoder input closed unexpectedly')
  let accepted
  try { accepted = encoder.child.stdin.write(png) }
  catch (error) { throw new Error(`Encoder input closed unexpectedly: ${error.message}`) }
  if (accepted) return
  await new Promise((resolveDrain, reject) => {
    const cleanup = () => {
      encoder.child.stdin.off('drain', onDrain)
      encoder.child.stdin.off('error', onError)
      encoder.child.off('close', onClose)
    }
    const onDrain = () => { cleanup(); resolveDrain() }
    const onError = error => { cleanup(); reject(new Error(`Encoder input closed unexpectedly: ${error.message}`)) }
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
  if (config.audioMode === 'copy') validateAudioCopy(project.audioPath, metadata)
  assertOutputSpace(config.output, metadata.duration, fs.statfsSync,
    config.audioMode === 'copy' ? fs.statSync(project.audioPath, { bigint: true }).size : 0)
  const totalFrames = metadata.totalFrames
  const vectorscopeMultiband = project.layers.some(layer => layer.type === 'vectorscope' && layer.visible && layer.multiband)
  const [width, height] = config.preset === '1080p' ? [1920, 1080] : [1280, 720]
  const temp = `${config.output}.partial-${randomUUID()}${outputFormat(config.audioMode).extension}`
  fs.mkdirSync(dirname(config.output), { recursive: true })
  const spectrumDirectory = jobPath('analysis', randomUUID())
  const oscilloscopeDirectory = jobPath('analysis', randomUUID())
  const spectrogramDirectory = jobPath('analysis', randomUUID())
  const waveformDirectory = jobPath('analysis', randomUUID())
  const vuDirectory = jobPath('analysis', randomUUID())
  const loudnessDirectory = jobPath('analysis', randomUUID())
  const waterfallDirectory = jobPath('analysis', randomUUID())
  let spectrumCache
  let oscilloscopeCache
  let spectrogramCache
  let waveformCache
  let vuCache
  let loudnessCache
  let waterfallCache
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
    vuCache = await precomputeVus(project.audioPath, metadata, project, nativeVu,
      vuDirectory, () => !fs.existsSync(config.cancelFile),
      (frames, total) => console.log(JSON.stringify({ event: 'vu-progress', frames, total })))
    loudnessCache = await precomputeLoudness(project.audioPath, metadata, project, nativeLoudness,
      loudnessDirectory, () => !fs.existsSync(config.cancelFile),
      (frames, total) => console.log(JSON.stringify({ event: 'loudness-progress', frames, total })))
    waterfallCache = await precomputeWaterfalls(project.audioPath, metadata, project, nativeWaterfall,
      waterfallDirectory, width / project.width, () => !fs.existsSync(config.cancelFile),
      (configuration, configurations, frames, total) => console.log(JSON.stringify({
        event: 'waterfall-progress', configuration, configurations, frames, total })))
    win = new BrowserWindow({ show: false, width, height,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true,
        backgroundThrottling: false } })
    lockWindowNavigation(win.webContents)
    win.webContents.on('console-message', details => {
      if (details.level === 'error') console.error(`Export renderer: ${details.message}`)
    })
    win.webContents.on('render-process-gone', (_event, details) => {
      console.error(`Export renderer stopped: ${details.reason}`)
    })
    await win.loadFile(join(__dirname, 'index.html'))
    const ready = await win.webContents.executeJavaScript('typeof window.phase2Export?.initialize')
    if (ready !== 'function') throw new Error('Offline composition failed to initialize')
    const images = assetData(project)
    await win.webContents.executeJavaScript(
      `window.phase2Export.initialize(${JSON.stringify(project)},${width},${height},${metadata.sampleRate},${JSON.stringify(images)})`)
    native.reset()
    native.setSampleRate(metadata.sampleRate)
    encoder = startEncoder(temp, project.audioPath, totalFrames, config.audioMode, metadata)
    // Open the decoder when rendering is ready to consume it. Starting it
    // before the hidden renderer initializes caused packaged 8 kHz exports
    // to report EOF at the first frame.
    reader = new PcmReader(project.audioPath, metadata.sampleRate)
    console.log(JSON.stringify({ event: 'started', input: project.audioPath, output: config.output,
      ...metadata, width, height, audioBitrate: encoder.audioBitrate,
      encoderPid: encoder.child.pid, decoderPid: reader.child.pid }))
    for (let index = 0; index < totalFrames; index++) {
      checkCancel(index)
      const nextSample = Math.min(Math.floor((index + 1) * metadata.sampleRate / FPS),
        Math.ceil(metadata.duration * metadata.sampleRate))
      const wanted = Math.max(0, nextSample - decodedFrames)
      const analysisStart = performance.now()
      const pcm = await reader.readFrames(wanted)
      if (pcm.frames === 0 && index < totalFrames - 1) throw new Error(`Decoder ended early at frame ${index}`)
      if (pcm.frames > 0) {
        native.pushSamples(pcm.left, pcm.right)
        if (vectorscopeMultiband) native.pushMultibandSamples(pcm.left, pcm.right)
      }
      decodedFrames += pcm.frames
      const result = native.getPoints(1024)
      const bands = vectorscopeMultiband ? native.getMultibandPoints(1024) : null
      analyzeMs += performance.now() - analysisStart
      const x = Buffer.from(result.x.buffer, result.x.byteOffset, result.count * 4).toString('base64')
      const y = Buffer.from(result.y.buffer, result.y.byteOffset, result.count * 4).toString('base64')
      const multiband = bands ? Buffer.from(bands.data.buffer, bands.data.byteOffset, bands.count * 6 * 4).toString('base64') : ''
      const renderStart = performance.now()
      const spectra = spectrumCache.frame()
      const oscilloscopes = oscilloscopeCache.frame()
      const spectrograms = spectrogramCache.frame()
      const waveforms = waveformCache.frame()
      const vus = vuCache.frame()
      const loudness = loudnessCache.frame()
      const waterfalls = waterfallCache.frame()
      const encoded = await win.webContents.executeJavaScript(`window.phase2Export.render(${JSON.stringify(x)},${JSON.stringify(y)},${JSON.stringify(multiband)},${JSON.stringify(spectra)},${JSON.stringify(oscilloscopes)},${JSON.stringify(spectrograms)},${JSON.stringify(waveforms)},${JSON.stringify(vus)},${JSON.stringify(loudness)},${JSON.stringify(waterfalls)},${index})`)
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
    checkCancel(renderedFrames)
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
    try { await reader?.close() } finally { spectrumCache?.close(); oscilloscopeCache?.close(); spectrogramCache?.close(); waveformCache?.close(); vuCache?.close(); loudnessCache?.close(); waterfallCache?.close(); win?.destroy() }
  }
}

app.disableHardwareAcceleration()
app.whenReady().then(exportVideo).then(() => app.quit()).catch(error => {
  console.error(error.message)
  app.exit(error.message === 'Export cancelled' ? 2 : 1)
})

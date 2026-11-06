const { BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { mediaPlan, MediaCache } = require('./project-media.cjs')
const { exportDimensions } = require('./project.cjs')
const { assetData } = require('./assets.cjs')
const { analyzeFrame } = require('./audio.cjs')
const { VideoFrames } = require('./video-frames.cjs')
const { jobPath } = require('./runtime.cjs')
const { lockWindowNavigation } = require('./window-security.cjs')
const { validateStillFrame, writeStill } = require('./still-output.cjs')

async function renderStill(project, config, native) {
  const plan = mediaPlan(project), frame = config.stillFrame
  validateStillFrame(frame, plan?.metadata)
  const { width, height } = exportDimensions(project, config.preset), scale = width / project.width
  const cache = new MediaCache(jobPath('still-media', randomUUID()))
  const abort = new AbortController()
  const current = () => !fs.existsSync(config.cancelFile)
  const cancelled = () => { if (!current()) throw new Error('Export cancelled') }
  const timer = setInterval(() => { if (!current()) abort.abort() }, 100)
  let win, video
  try {
    console.log(JSON.stringify({ event: 'started', kind: 'still', width, height, frameIndex: frame, output: config.output }))
    const prepared = plan ? await cache.prepare(project, abort.signal, {
      start: 0, end: Math.min(plan.metadata.duration, (frame + 1) / 30),
    }) : null
    cancelled()
    const sampleRate = prepared?.metadata.sampleRate || 48000
    let data = { x: '', y: '', multiband: '', spectra: {}, oscilloscopes: {}, spectrograms: {}, waveforms: {}, vus: {}, loudness: {}, waterfalls: {} }
    if (prepared) {
      const input = prepared.analysisPath, metadata = prepared.metadata
      if (project.layers.some(layer => layer.type === 'vectorscope' && layer.visible)) {
        Object.assign(data, await analyzeFrame(input, metadata, frame, native.vectorscope, current,
          project.layers.some(layer => layer.type === 'vectorscope' && layer.visible && layer.multiband)))
      }
      // History is rebuilt at the output resolution; only one picture is rendered.
      for (const [family, method, backend] of [
        ['spectrum','previewSpectra','spectrum'], ['oscilloscope','previewOscilloscopes','oscilloscope'],
        ['spectrogram','previewSpectrograms','spectrogram'], ['waveform','previewWaveforms','waveform'],
        ['vu','previewVus','vumeter'], ['loudness','previewLoudness','lufsmeter'], ['waterfall','previewWaterfalls','waterfall'],
      ]) {
        const key = {spectrum:'spectra',oscilloscope:'oscilloscopes',spectrogram:'spectrograms',waveform:'waveforms',vu:'vus',loudness:'loudness',waterfall:'waterfalls'}[family]
        data[key] = await require(`../phase3/${family}.cjs`)[method](input, metadata, frame, project, native[backend], current, scale)
      }
    }
    cancelled()
    win = new BrowserWindow({ show: false, width, height, webPreferences: {
      contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false,
    } })
    lockWindowNavigation(win.webContents)
    await win.loadFile(path.join(__dirname, 'export-app', 'index.html'))
    await win.webContents.executeJavaScript(`window.phase2Export.initialize(${JSON.stringify(project)},${width},${height},${sampleRate},${JSON.stringify(assetData(project))})`)
    let picture = ''
    if (plan?.video?.visible && plan.video.opacity > 0) {
      video = new VideoFrames(plan.video, 1 / 30, Math.max(width, height), frame / 30)
      picture = await video.read()
    }
    cancelled()
    const args = [data.x, data.y, data.multiband, data.spectra, data.oscilloscopes, data.spectrograms,
      data.waveforms, data.vus, data.loudness, data.waterfalls, frame, picture]
    const encoded = await win.webContents.executeJavaScript(`window.phase2Export.render(...${JSON.stringify(args)})`)
    cancelled()
    fs.mkdirSync(path.dirname(config.output), { recursive: true })
    writeStill(config.output, Buffer.from(encoded, 'base64'))
    console.log(JSON.stringify({ event: 'finished', kind: 'still', output: config.output, frames: 1, frameIndex: frame, width, height }))
  } finally { clearInterval(timer); try { await video?.close() } finally { win?.destroy(); await cache.close() } }
}
module.exports = { renderStill }

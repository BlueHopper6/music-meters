const { app, BrowserWindow, dialog, ipcMain } = require('electron')
const { join, resolve, dirname, extname, relative, isAbsolute } = require('node:path')
const { spawn } = require('node:child_process')
const { randomUUID } = require('node:crypto')
const fs = require('node:fs')
const { jobPath } = require('../runtime.cjs')
const { defaultProject, normalizeProject } = require('../project.cjs')
const { installedFonts, assertInstalledFonts } = require('../fonts.cjs')
const { readImage, imagePaths, assetData, saveArtwork, resolveArtwork } = require('../assets.cjs')
const { listTemplates, readTemplate, saveTemplate, duplicateTemplate, renameTemplate, applyTemplate, titleSuggestion } = require('../templates.cjs')
const { readPreferences, writePreferences } = require('../preferences.cjs')
const { probeAudio, analyzeFrame } = require('../audio.cjs')
const { previewSpectra } = require('../../phase3/spectrum.cjs')
const { previewOscilloscopes } = require('../../phase3/oscilloscope.cjs')
const { previewSpectrograms } = require('../../phase3/spectrogram.cjs')
const { previewWaveforms } = require('../../phase3/waveform.cjs')
const { previewVus } = require('../../phase3/vu.cjs')
const { previewLoudness } = require('../../phase3/loudness.cjs')
const { previewWaterfalls } = require('../../phase3/waterfall.cjs')

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
const AUDIO_EXTENSIONS = new Set(['.wav', '.mp3', '.flac'])
if (process.env.PHASE5_TEST_USER_DATA) app.setPath('userData', process.env.PHASE5_TEST_USER_DATA)
let win
let project = defaultProject()
const allowedImages = new Set()
let metadata = null
let activeAudio = ''
let projectPath = null
let previewGeneration = 0
let previewQueue = Promise.resolve()
let exportJob = null
let closingAfterExport = false
const userData = () => app.getPath('userData')

function missingMedia(value) {
  const missing = []
  if (value.audioPath && !fs.existsSync(value.audioPath)) missing.push({ kind: 'audio', label: 'Audio', path: value.audioPath })
  if (value.version === 2) {
    if (value.background.type === 'image' && value.background.imagePath && !fs.existsSync(value.background.imagePath)) {
      missing.push({ kind: 'background', label: 'Background image', path: value.background.imagePath })
    }
    for (const layer of value.layers) if (layer.type === 'image' && layer.imagePath && !fs.existsSync(layer.imagePath)) {
      missing.push({ kind: 'layer', id: layer.id, label: layer.name, path: layer.imagePath })
    }
  }
  return missing
}

function suggestedOutput(value) {
  const title = value.title && value.title !== 'Untitled track' ? value.title : titleSuggestion(value.audioPath)
  const safe = title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').replace(/[. ]+$/g, '').trim().slice(0, 120) || 'visualizer'
  return join(projectPath ? dirname(projectPath) : dirname(value.audioPath), `${safe}_visualizer.mp4`)
}

function audioInfo(input) {
  const absolute = resolve(input)
  if (!AUDIO_EXTENSIONS.has(extname(absolute).toLowerCase())) throw new Error('Choose a WAV, MP3, or FLAC file')
  if (!fs.statSync(absolute).isFile()) throw new Error('Audio path is not a file')
  return { path: absolute, metadata: probeAudio(absolute) }
}

function sendExport(value) {
  if (win && !win.isDestroyed()) win.webContents.send('export-event', value)
}

function validateActiveProject(raw) {
  const normalized = normalizeProject(raw)
  assertInstalledFonts(normalized)
  if (normalized.audioPath !== activeAudio && normalized.audioPath !== project.audioPath) {
    throw new Error('Project audio does not match the imported file')
  }
  for (const input of imagePaths(normalized)) if (!allowedImages.has(input)) {
    throw new Error('Choose artwork through the local image picker')
  }
  return normalized
}

ipcMain.handle('initial', () => ({ project, metadata, projectPath, fonts: installedFonts(),
  templates: listTemplates(userData()), preferences: readPreferences(userData()), missingMedia: missingMedia(project) }))
ipcMain.handle('list-templates', () => listTemplates(userData()))
ipcMain.handle('save-template', (_event, name, raw) => {
  const value = validateActiveProject(raw)
  const entry = saveTemplate(userData(), name, value)
  writePreferences(userData(), { lastTemplateId: entry.id })
  return entry
})
ipcMain.handle('duplicate-template', (_event, id, name) => {
  const entry = duplicateTemplate(userData(), id, name)
  writePreferences(userData(), { lastTemplateId: entry.id })
  return entry
})
ipcMain.handle('rename-template', (_event, id, name) => renameTemplate(userData(), id, name))
ipcMain.handle('load-template', (_event, id, raw) => {
  const current = validateActiveProject(raw)
  const next = applyTemplate(readTemplate(userData(), id).layout, current)
  assertInstalledFonts(next)
  for (const input of imagePaths(next)) allowedImages.add(input)
  project = next
  previewGeneration++
  writePreferences(userData(), { lastTemplateId: id })
  return { project: next, missingMedia: missingMedia(next) }
})
ipcMain.handle('set-export-preset', (_event, preset) => writePreferences(userData(), { exportPreset: preset }))
ipcMain.handle('choose-image', async () => {
  let selected = process.env.PHASE4_TEST_IMAGE_PATH || ''
  if (!selected) {
    const result = await dialog.showOpenDialog(win, { title: 'Choose local artwork',
      properties: ['openFile'], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] })
    if (result.canceled) return null
    selected = result.filePaths[0]
  }
  const absolute = resolve(selected)
  readImage(absolute)
  allowedImages.add(absolute)
  return absolute
})
ipcMain.handle('load-assets', (_event, raw) => {
  const value = validateActiveProject(raw)
  for (const input of imagePaths(value)) if (!allowedImages.has(input)) throw new Error('Choose artwork through the local image picker')
  return assetData(value, false)
})
ipcMain.handle('choose-audio', async () => {
  let selected = process.env.PHASE2_TEST_IMPORT_PATH || ''
  if (!selected) {
    const result = await dialog.showOpenDialog(win, {
      title: 'Import audio', properties: ['openFile'],
      filters: [{ name: 'Audio', extensions: ['wav', 'mp3', 'flac'] }],
    })
    if (result.canceled) return null
    selected = result.filePaths[0]
  }
  const chosen = audioInfo(selected)
  activeAudio = chosen.path
  metadata = chosen.metadata
  previewGeneration++
  project.audioPath = activeAudio
  return chosen
})
ipcMain.handle('preview-at', async (_event, frame, raw) => {
  if (!metadata || !activeAudio) throw new Error('Import audio before previewing')
  if (!Number.isSafeInteger(frame) || frame < 0 || frame >= metadata.totalFrames) {
    throw new Error('Preview frame is outside the song')
  }
  const value = validateActiveProject(raw)
  const generation = ++previewGeneration
  const input = activeAudio
  const info = metadata
  const current = () => generation === previewGeneration
  const job = previewQueue.catch(() => {}).then(async () => {
    const multiband = value.layers.some(layer => layer.type === 'vectorscope' && layer.visible && layer.multiband)
    const vectorscope = await analyzeFrame(input, info, frame, native, current, multiband)
    const spectra = await previewSpectra(input, info, frame, value, nativeSpectrum, current)
    const oscilloscopes = await previewOscilloscopes(input, info, frame, value, nativeOscilloscope, current)
    const spectrograms = await previewSpectrograms(input, info, frame, value, nativeSpectrogram, current)
    const waveforms = await previewWaveforms(input, info, frame, value, nativeWaveform, current)
    const vus = await previewVus(input, info, frame, value, nativeVu, current)
    const loudness = await previewLoudness(input, info, frame, value, nativeLoudness, current)
    const waterfalls = await previewWaterfalls(input, info, frame, value, nativeWaterfall, current)
    return { ...vectorscope, spectra, oscilloscopes, spectrograms, waveforms, vus, loudness, waterfalls }
  }).catch(error => {
    if (error.message === 'Preview superseded') return { superseded: true }
    throw error
  })
  previewQueue = job
  return job
})
ipcMain.handle('save-project', async (_event, raw, asNew = false) => {
  const value = validateActiveProject(raw)
  if (typeof asNew !== 'boolean') throw new Error('Invalid Save As setting')
  let target = process.env.PHASE2_TEST_PROJECT_PATH || (asNew ? null : projectPath)
  if (!target) {
    const result = await dialog.showSaveDialog(win, {
      title: asNew ? 'Save project as' : 'Save project',
      defaultPath: projectPath || `${titleSuggestion(value.audioPath || value.title)}-project.json`,
      filters: [{ name: 'Visualizer project', extensions: ['json'] }],
    })
    if (result.canceled) return null
    target = result.filePath
  }
  if (extname(target).toLowerCase() !== '.json') throw new Error('Project file must end in .json')
  const reference = activeAudio || value.audioPath
  const document = { ...saveArtwork(value, target), audioPath: undefined,
    audioRelativePath: reference ? relative(dirname(target), reference).replaceAll('\\', '/') : '' }
  fs.mkdirSync(dirname(target), { recursive: true })
  fs.writeFileSync(target, JSON.stringify(document, null, 2) + '\n', { flag: 'w' })
  project = normalizeProject(resolveArtwork({ ...document, audioPath: reference }, target))
  for (const input of imagePaths(project)) allowedImages.add(input)
  projectPath = target
  return { path: target, project, missingMedia: missingMedia(project) }
})
ipcMain.handle('open-project', async () => {
  let target = process.env.PHASE2_TEST_PROJECT_PATH || ''
  if (!target) {
    const result = await dialog.showOpenDialog(win, {
      title: 'Open project', properties: ['openFile'],
      filters: [{ name: 'Visualizer project', extensions: ['json'] }],
    })
    if (result.canceled) return null
    target = result.filePaths[0]
  }
  if (fs.statSync(target).size > 1024 * 1024) throw new Error('Project file is too large')
  const stored = JSON.parse(fs.readFileSync(target, 'utf8'))
  const ref = stored.audioRelativePath
  if (typeof ref !== 'string' || ref.length > 4096 || isAbsolute(ref)) {
    throw new Error('Project audio reference is invalid')
  }
  const candidate = ref ? resolve(dirname(target), ref) : ''
  const value = normalizeProject(resolveArtwork({ ...stored, audioPath: candidate }, target))
  assertInstalledFonts(value)
  allowedImages.clear()
  for (const input of imagePaths(value)) allowedImages.add(input)
  let nextMetadata = null
  let nextAudio = ''
  if (candidate && fs.existsSync(candidate)) {
    const info = audioInfo(candidate)
    nextMetadata = info.metadata
    nextAudio = info.path
  }
  previewGeneration++
  project = value
  metadata = nextMetadata
  activeAudio = nextAudio
  projectPath = target
  return { project, metadata, projectPath, fonts: installedFonts(),
    templates: listTemplates(userData()), preferences: readPreferences(userData()), missingMedia: missingMedia(project) }
})
ipcMain.handle('render-mp4', async (_event, raw, preset) => {
  if (exportJob) throw new Error('An export is already running')
  if (!metadata || !activeAudio) throw new Error('Import audio before rendering')
  if (!['720p', '1080p'].includes(preset)) throw new Error('Unsupported export preset')
  const value = validateActiveProject(raw)
  assetData(value)
  writePreferences(userData(), { exportPreset: preset })
  let output = process.env.PHASE2_TEST_OUTPUT_PATH || ''
  if (!output) {
    let suggestion = suggestedOutput(value)
    while (true) {
      const result = await dialog.showSaveDialog(win, {
        title: 'Render MP4', defaultPath: suggestion,
        filters: [{ name: 'MP4 video', extensions: ['mp4'] }],
      })
      if (result.canceled) return null
      output = resolve(result.filePath)
      if (!fs.existsSync(output)) break
      const response = await dialog.showMessageBox(win, { type: 'warning',
        message: 'That MP4 already exists.', detail: 'Choose a different filename. Existing videos are never overwritten.',
        buttons: ['Choose another name', 'Cancel'], defaultId: 0, cancelId: 1 })
      if (response.response === 1) return null
      suggestion = output
    }
  }
  output = resolve(output)
  if (extname(output).toLowerCase() !== '.mp4') throw new Error('Output must end in .mp4')
  if (fs.existsSync(output)) throw new Error(`Output already exists: ${output}`)
  const controlDir = jobPath('jobs')
  fs.mkdirSync(controlDir, { recursive: true })
  const cancelFile = join(controlDir, `${randomUUID()}.cancel`)
  const child = spawn(process.execPath, [join(ROOT, 'phase2', 'export-app')], {
    env: { ...process.env, PHASE2_JOB: JSON.stringify({ project: value, output, cancelFile, preset }) },
    stdio: ['ignore', 'pipe', 'pipe'], shell: false, detached: true, windowsHide: true,
  })
  const job = { child, cancelFile, output, finishedEvent: null, errors: '' }
  exportJob = job
  let lineBuffer = ''
  child.stdout.on('data', chunk => {
    lineBuffer += chunk.toString()
    let end
    while ((end = lineBuffer.indexOf('\n')) >= 0) {
      const line = lineBuffer.slice(0, end).trim()
      lineBuffer = lineBuffer.slice(end + 1)
      if (!line) continue
      try {
        const value = JSON.parse(line)
        if (value.event === 'finished') job.finishedEvent = value
        else sendExport(value)
      } catch { job.errors = (job.errors + line).slice(-4096) }
    }
  })
  child.stderr.on('data', chunk => { job.errors = (job.errors + chunk.toString()).slice(-4096) })
  child.once('error', error => { job.errors = error.message })
  child.once('close', code => {
    fs.rmSync(cancelFile, { force: true })
    exportJob = null
    if (code === 0 && job.finishedEvent) sendExport(job.finishedEvent)
    else sendExport({ event: code === 2 ? 'cancelled' : 'failed',
      message: job.errors.trim() || `Exporter exited ${code}`, output })
    if (closingAfterExport) app.quit()
  })
  return output
})
ipcMain.handle('cancel-render', () => {
  if (exportJob) fs.writeFileSync(exportJob.cancelFile, 'cancel')
})

app.disableHardwareAcceleration()
app.whenReady().then(() => {
  if (process.env.PHASE2_TEST_INPUT) {
    const info = audioInfo(process.env.PHASE2_TEST_INPUT)
    activeAudio = info.path
    metadata = info.metadata
    project.audioPath = activeAudio
  }
  win = new BrowserWindow({
    width: 1480, height: 900, minWidth: 1000, minHeight: 700,
    icon: join(__dirname, 'assets', 'brand', 'music-meters.ico'),
    show: process.env.PHASE2_HEADLESS !== '1',
    webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true,
      nodeIntegration: false, sandbox: true, backgroundThrottling: false },
  })
  return win.loadFile(join(__dirname, 'index.html')).then(async () => {
    if (process.env.PHASE6_REPEAT_SMOKE === '1' || process.env.PHASE5_RELINK_SMOKE === '1' || process.env.PHASE5_WORKFLOW_SMOKE === '1' || process.env.PHASE4_LEGACY_SMOKE === '1' || process.env.PHASE4_COMPOSITION_SMOKE === '1' || process.env.PHASE2_SMOKE === '1' || process.env.PHASE2_LONG_PREVIEW === '1' || process.env.PHASE2_MISSING_SMOKE === '1' || process.env.PHASE3_SPECTRUM_SMOKE === '1' || process.env.PHASE3_OSCILLOSCOPE_SMOKE === '1' || process.env.PHASE3_OSCILLOSCOPE_LONG === '1' || process.env.PHASE3_SPECTROGRAM_SMOKE === '1' || process.env.PHASE3_WAVEFORM_SMOKE === '1' || process.env.PHASE3_VU_SMOKE === '1' || process.env.PHASE3_LOUDNESS_SMOKE === '1' || process.env.PHASE3_WATERFALL_SMOKE === '1' || process.env.PHASE3_VECTORSCOPE_SMOKE === '1' || process.env.PHASE3_ALL_METERS_SMOKE === '1') {
      try {
        if (process.env.PHASE6_REPEAT_SMOKE === '1') await require('../../phase6/test/repeat-smoke.cjs')(win)
        else if (process.env.PHASE5_RELINK_SMOKE === '1') await require('../../phase5/test/relink-smoke.cjs')(win)
        else if (process.env.PHASE5_WORKFLOW_SMOKE === '1') await require('../../phase5/test/editor-smoke.cjs')(win)
        else if (process.env.PHASE4_LEGACY_SMOKE === '1') await require('../../phase4/test/legacy-smoke.cjs')(win)
        else if (process.env.PHASE4_COMPOSITION_SMOKE === '1') await require('../../phase4/test/editor-smoke.cjs')(win)
        else if (process.env.PHASE3_ALL_METERS_SMOKE === '1') await require('../../phase3/test/all-meters-smoke.cjs')(win)
        else if (process.env.PHASE3_VECTORSCOPE_SMOKE === '1') await require('../../phase3/test/vectorscope-smoke.cjs')(win)
        else if (process.env.PHASE3_WATERFALL_SMOKE === '1') await require('../../phase3/test/waterfall-smoke.cjs')(win)
        else if (process.env.PHASE3_LOUDNESS_SMOKE === '1') await require('../../phase3/test/loudness-smoke.cjs')(win)
        else if (process.env.PHASE3_VU_SMOKE === '1') await require('../../phase3/test/vu-smoke.cjs')(win)
        else if (process.env.PHASE3_WAVEFORM_SMOKE === '1') await require('../../phase3/test/waveform-smoke.cjs')(win)
        else if (process.env.PHASE3_SPECTROGRAM_SMOKE === '1') await require('../../phase3/test/spectrogram-smoke.cjs')(win)
        else if (process.env.PHASE3_OSCILLOSCOPE_LONG === '1') await require('../../phase3/test/oscilloscope-long-preview.cjs')(win)
        else if (process.env.PHASE3_OSCILLOSCOPE_SMOKE === '1') await require('../../phase3/test/oscilloscope-smoke.cjs')(win)
        else if (process.env.PHASE3_SPECTRUM_SMOKE === '1') await require('../../phase3/test/editor-smoke.cjs')(win)
        else if (process.env.PHASE2_MISSING_SMOKE === '1') await require('../test/missing-audio.cjs')(win)
        else if (process.env.PHASE2_LONG_PREVIEW === '1') await require('../test/long-preview.cjs')(win)
        else await require('../test/editor-smoke.cjs')(win)
      }
      catch (error) { console.error(error.stack || error); app.exit(1) }
    }
  })
}).catch(error => { console.error(error); app.exit(1) })
app.on('window-all-closed', () => app.quit())
app.on('before-quit', event => {
  if (exportJob) {
    event.preventDefault()
    closingAfterExport = true
    fs.writeFileSync(exportJob.cancelFile, 'cancel')
  }
})

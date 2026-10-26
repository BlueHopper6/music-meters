const { app, BrowserWindow, dialog, ipcMain } = require('electron')
const { join, resolve, dirname, extname, relative, isAbsolute, basename } = require('node:path')
const { spawn } = require('node:child_process')
const { Worker } = require('node:worker_threads')
const { randomUUID } = require('node:crypto')
const fs = require('node:fs')
const { jobPath } = require('../runtime.cjs')
const { defaultProject, normalizeProject } = require('../project.cjs')
const { encapsulateProjectPath } = require('../project-path.cjs')
const { installedFonts, assertInstalledFonts } = require('../fonts.cjs')
const { readImage, imagePaths, assetData, saveArtwork, resolveArtwork } = require('../assets.cjs')
const { listTemplates, readTemplate, saveTemplate, duplicateTemplate, renameTemplate, deleteTemplate, applyTemplate, titleSuggestion } = require('../templates.cjs')
const { readPreferences, writePreferences, recordRecentProject } = require('../preferences.cjs')
const { probeAudio } = require('../audio.cjs')
const { outputFormat, validateOutputPath, validateAudioCopy } = require('../audio-output.cjs')
const { lockWindowNavigation, assertTrustedSender } = require('../window-security.cjs')

const ROOT = resolve(__dirname, '..', '..')
const AUDIO_EXTENSIONS = new Set(['.wav', '.mp3', '.flac'])
if (process.env.PHASE5_TEST_USER_DATA) app.setPath('userData', process.env.PHASE5_TEST_USER_DATA)
let win
let forceQuit = false
let project = defaultProject()
const allowedImages = new Set()
let metadata = null
let activeAudio = ''
let projectPath = null
let previewGeneration = 0
let previewAudioRevision = 0
let previewWorker = null
const pendingPreviews = new Map()
let exportJob = null
let closingAfterExport = false
const userData = () => app.getPath('userData')
const editorDocument = join(__dirname, 'index.html')

function handle(channel, callback) {
  ipcMain.handle(channel, (event, ...args) => {
    assertTrustedSender(event, win?.webContents, editorDocument)
    return callback(event, ...args)
  })
}

function cancelPreview() {
  const id = ++previewGeneration
  for (const pending of pendingPreviews.values()) pending.resolve({ superseded: true })
  pendingPreviews.clear()
  previewWorker?.postMessage({ type: 'cancel', id })
}

function getPreviewWorker() {
  if (previewWorker) return previewWorker
  const worker = new Worker(join(ROOT, 'phase2', 'preview-worker.cjs'))
  previewWorker = worker
  worker.unref()
  worker.on('message', ({ id, result, error }) => {
    const pending = pendingPreviews.get(id)
    if (!pending) return
    pendingPreviews.delete(id)
    if (error) pending.reject(new Error(error))
    else pending.resolve(result)
  })
  const failed = error => {
    if (previewWorker !== worker) return
    previewWorker = null
    for (const pending of pendingPreviews.values()) pending.reject(error)
    pendingPreviews.clear()
  }
  worker.on('error', failed)
  worker.on('exit', code => failed(new Error(`Preview worker exited ${code}`)))
  return worker
}

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

function suggestedOutput(value, audioMode) {
  const title = value.title && value.title !== 'Untitled track' ? value.title : titleSuggestion(value.audioPath)
  const safe = title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').replace(/[. ]+$/g, '').trim().slice(0, 120) || 'visualizer'
  return join(projectPath ? dirname(projectPath) : dirname(value.audioPath),
    `${safe}_visualizer${outputFormat(audioMode).extension}`)
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

const isAutomatedTest = Boolean(
  process.env.PHASE2_TEST_INPUT ||
  process.env.PHASE2_TEST_PROJECT_PATH ||
  process.env.PHASE6_SECURITY_SMOKE ||
  process.env.PHASE6_AUDIO_COPY_EDITOR_SMOKE ||
  process.env.PHASE6_PREVIEW_PERF_SMOKE ||
  process.env.PHASE6_REPEAT_SMOKE ||
  process.env.PHASE5_RELINK_SMOKE ||
  process.env.PHASE5_WORKFLOW_SMOKE ||
  process.env.PHASE4_LEGACY_SMOKE ||
  process.env.PHASE4_COMPOSITION_SMOKE ||
  process.env.PHASE3_ALL_METERS_SMOKE ||
  process.env.PHASE3_VECTORSCOPE_SMOKE ||
  process.env.PHASE3_WATERFALL_SMOKE ||
  process.env.PHASE3_LOUDNESS_SMOKE ||
  process.env.PHASE3_VU_SMOKE ||
  process.env.PHASE3_WAVEFORM_SMOKE ||
  process.env.PHASE3_SPECTROGRAM_SMOKE ||
  process.env.PHASE3_OSCILLOSCOPE_LONG ||
  process.env.PHASE3_OSCILLOSCOPE_SMOKE ||
  process.env.PHASE3_SPECTRUM_SMOKE ||
  process.env.PHASE2_MISSING_SMOKE ||
  process.env.PHASE2_LONG_PREVIEW ||
  process.env.PHASE2_SMOKE
)

handle('initial', () => ({ project, metadata, projectPath, fonts: installedFonts(),
  templates: listTemplates(userData()), preferences: readPreferences(userData()), missingMedia: missingMedia(project),
  isStartupSession: process.env.PHASE2_STARTUP_SMOKE === '1' || !isAutomatedTest }))
handle('get-recent-projects', () => readPreferences(userData()).recentProjects || [])
handle('new-blank-project', () => {
  cancelPreview()
  const fresh = defaultProject()
  fresh.layers = []
  fresh.title = 'Untitled project'
  project = fresh
  projectPath = null
  activeAudio = ''
  metadata = null
  allowedImages.clear()
  return { project, metadata, projectPath, fonts: installedFonts(),
    templates: listTemplates(userData()), preferences: readPreferences(userData()), missingMedia: [] }
})
handle('close-project', () => {
  cancelPreview()
  const fresh = defaultProject()
  fresh.layers = []
  fresh.title = 'Untitled project'
  project = fresh
  projectPath = null
  activeAudio = ''
  metadata = null
  allowedImages.clear()
  return { project, metadata, projectPath, fonts: installedFonts(),
    templates: listTemplates(userData()), preferences: readPreferences(userData()), missingMedia: [] }
})
handle('new-project-from-template', (_event, templateId) => {
  if (!templateId || typeof templateId !== 'string') throw new Error('Choose a template')
  cancelPreview()
  const tmpl = readTemplate(userData(), templateId)
  const base = defaultProject()
  base.title = 'Untitled project'
  const applied = applyTemplate(tmpl.layout, base)
  assertInstalledFonts(applied)
  allowedImages.clear()
  for (const input of imagePaths(applied)) allowedImages.add(input)
  project = applied
  projectPath = null
  activeAudio = ''
  metadata = null
  return { project, metadata, projectPath, fonts: installedFonts(),
    templates: listTemplates(userData()), preferences: readPreferences(userData()), missingMedia: missingMedia(project) }
})
handle('list-templates', () => listTemplates(userData()))
handle('save-template', (_event, name, raw, overwriteId = '') => {
  const value = validateActiveProject(raw)
  const entry = saveTemplate(userData(), name, value, overwriteId)
  writePreferences(userData(), { lastTemplateId: entry.id })
  return entry
})
handle('duplicate-template', (_event, id, name) => {
  const entry = duplicateTemplate(userData(), id, name)
  writePreferences(userData(), { lastTemplateId: entry.id })
  return entry
})
handle('rename-template', (_event, id, name) => renameTemplate(userData(), id, name))
handle('delete-template', (_event, id) => {
  const removed = deleteTemplate(userData(), id)
  if (readPreferences(userData()).lastTemplateId === id) {
    writePreferences(userData(), { lastTemplateId: '' })
  }
  return removed
})
handle('load-template', (_event, id, raw) => {
  const current = validateActiveProject(raw)
  const next = applyTemplate(readTemplate(userData(), id).layout, current)
  assertInstalledFonts(next)
  for (const input of imagePaths(next)) allowedImages.add(input)
  project = next
  cancelPreview()
  writePreferences(userData(), { lastTemplateId: id })
  return { project: next, missingMedia: missingMedia(next) }
})
handle('set-export-preset', (_event, preset) => writePreferences(userData(), { exportPreset: preset }))
handle('choose-image', async () => {
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
handle('load-assets', (_event, raw) => {
  const value = validateActiveProject(raw)
  for (const input of imagePaths(value)) if (!allowedImages.has(input)) throw new Error('Choose artwork through the local image picker')
  return assetData(value, false)
})
handle('choose-audio', async () => {
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
  previewAudioRevision++
  cancelPreview()
  project.audioPath = activeAudio
  return chosen
})
handle('preview-at', async (_event, frame, raw) => {
  if (!metadata || !activeAudio) throw new Error('Import audio before previewing')
  if (!Number.isSafeInteger(frame) || frame < 0 || frame >= metadata.totalFrames) {
    throw new Error('Preview frame is outside the song')
  }
  const value = validateActiveProject(raw)
  cancelPreview()
  const id = previewGeneration
  const worker = getPreviewWorker()
  return new Promise((resolve, reject) => {
    pendingPreviews.set(id, { resolve, reject })
    try { worker.postMessage({ type: 'preview', id, input: activeAudio, metadata,
      frame, project: value, audioRevision: previewAudioRevision }) }
    catch (error) { pendingPreviews.delete(id); reject(error) }
  })
})
handle('cancel-preview', () => cancelPreview())
handle('save-project', async (_event, raw, asNew = false) => {
  const value = validateActiveProject(raw)
  if (typeof asNew !== 'boolean') throw new Error('Invalid Save As setting')
  let target = process.env.PHASE2_TEST_PROJECT_PATH || (asNew ? null : projectPath)
  if (!target) {
    if (process.env.PHASE2_TEST_SAVE_PATH) {
      target = encapsulateProjectPath(process.env.PHASE2_TEST_SAVE_PATH)
    } else {
      const result = await dialog.showSaveDialog(win, {
        title: asNew ? 'Save project as' : 'Save project',
        defaultPath: projectPath || `${titleSuggestion(value.audioPath || value.title)}-project.json`,
        filters: [{ name: 'Visualizer project', extensions: ['json'] }],
      })
      if (result.canceled) return null
      target = encapsulateProjectPath(result.filePath)
    }
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
  recordRecentProject(userData(), target, project.title)
  return { path: target, project, missingMedia: missingMedia(project) }
})
function loadProjectFromDisk(target) {
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
  previewAudioRevision++
  cancelPreview()
  project = value
  metadata = nextMetadata
  activeAudio = nextAudio
  projectPath = target
  recordRecentProject(userData(), target, value.title)
  return { project, metadata, projectPath, fonts: installedFonts(),
    templates: listTemplates(userData()), preferences: readPreferences(userData()), missingMedia: missingMedia(project) }
}

handle('open-project', async () => {
  let target = process.env.PHASE2_TEST_PROJECT_PATH || ''
  if (!target) {
    const result = await dialog.showOpenDialog(win, {
      title: 'Open project', properties: ['openFile'],
      filters: [{ name: 'Visualizer project', extensions: ['json'] }],
    })
    if (result.canceled) return null
    target = result.filePaths[0]
  }
  return loadProjectFromDisk(target)
})

handle('open-project-path', async (_event, targetPath) => {
  if (!targetPath || typeof targetPath !== 'string') throw new Error('Invalid project path')
  const resolved = resolve(targetPath)
  if (!fs.existsSync(resolved)) throw new Error('Project file not found: ' + resolved)
  return loadProjectFromDisk(resolved)
})
handle('render-video', async (_event, raw, preset, audioMode) => {
  if (exportJob) throw new Error('An export is already running')
  if (!metadata || !activeAudio) throw new Error('Import audio before rendering')
  if (!['720p', '1080p'].includes(preset)) throw new Error('Unsupported export preset')
  const format = outputFormat(audioMode)
  if (audioMode === 'copy') validateAudioCopy(activeAudio, metadata)
  const value = validateActiveProject(raw)
  assetData(value)
  writePreferences(userData(), { exportPreset: preset })
  let output = process.env.PHASE2_TEST_OUTPUT_PATH || ''
  if (!output) {
    let suggestion = suggestedOutput(value, audioMode)
    while (true) {
      const result = await dialog.showSaveDialog(win, {
        title: `Render ${format.container} video`, defaultPath: suggestion,
        filters: [{ name: `${format.container} video`, extensions: [format.extension.slice(1)] }],
      })
      if (result.canceled) return null
      output = resolve(result.filePath)
      if (!extname(output)) output += format.extension
      validateOutputPath(output, audioMode)
      if (!fs.existsSync(output)) break
      const response = await dialog.showMessageBox(win, { type: 'warning',
        message: `That ${format.container} already exists.`, detail: 'Choose a different filename. Existing videos are never overwritten.',
        buttons: ['Choose another name', 'Cancel'], defaultId: 0, cancelId: 1 })
      if (response.response === 1) return null
      suggestion = output
    }
  }
  output = resolve(output)
  validateOutputPath(output, audioMode)
  if (fs.existsSync(output)) throw new Error(`Output already exists: ${output}`)
  const controlDir = jobPath('jobs')
  fs.mkdirSync(controlDir, { recursive: true })
  const cancelFile = join(controlDir, `${randomUUID()}.cancel`)
  const child = spawn(process.execPath, [join(ROOT, 'phase2', 'export-app')], {
    env: { ...process.env, PHASE2_JOB: JSON.stringify({ project: value, output, cancelFile, preset, audioMode }) },
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
handle('confirm-app-close', () => {
  forceQuit = true
  if (win && !win.isDestroyed()) win.close()
})
handle('cancel-render', () => {
  if (exportJob) fs.writeFileSync(exportJob.cancelFile, 'cancel')
})

app.disableHardwareAcceleration()
app.whenReady().then(() => {
  if (process.env.PHASE2_TEST_INPUT) {
    const info = audioInfo(process.env.PHASE2_TEST_INPUT)
    activeAudio = info.path
    metadata = info.metadata
    project.audioPath = activeAudio
    previewAudioRevision++
  }
  win = new BrowserWindow({
    width: 1480, height: 900, minWidth: 1000, minHeight: 700,
    icon: join(__dirname, 'assets', 'brand', 'music-meters.ico'),
    show: process.env.PHASE2_HEADLESS !== '1',
    webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true,
      nodeIntegration: false, sandbox: true, backgroundThrottling: false },
  })
  lockWindowNavigation(win.webContents)
  win.on('close', event => {
    if (forceQuit || isAutomatedTest) return
    event.preventDefault()
    win.webContents.send('app-close-requested')
  })
  return win.loadFile(editorDocument).then(async () => {
    if (process.env.PHASE2_STARTUP_SMOKE === '1' || process.env.PHASE6_SECURITY_SMOKE === '1' || process.env.PHASE6_AUDIO_COPY_EDITOR_SMOKE === '1' || process.env.PHASE6_PREVIEW_PERF_SMOKE === '1' || process.env.PHASE6_REPEAT_SMOKE === '1' || process.env.PHASE5_RELINK_SMOKE === '1' || process.env.PHASE5_WORKFLOW_SMOKE === '1' || process.env.PHASE4_LEGACY_SMOKE === '1' || process.env.PHASE4_COMPOSITION_SMOKE === '1' || process.env.PHASE2_SMOKE === '1' || process.env.PHASE2_LONG_PREVIEW === '1' || process.env.PHASE2_MISSING_SMOKE === '1' || process.env.PHASE3_SPECTRUM_SMOKE === '1' || process.env.PHASE3_OSCILLOSCOPE_SMOKE === '1' || process.env.PHASE3_OSCILLOSCOPE_LONG === '1' || process.env.PHASE3_SPECTROGRAM_SMOKE === '1' || process.env.PHASE3_WAVEFORM_SMOKE === '1' || process.env.PHASE3_VU_SMOKE === '1' || process.env.PHASE3_LOUDNESS_SMOKE === '1' || process.env.PHASE3_WATERFALL_SMOKE === '1' || process.env.PHASE3_VECTORSCOPE_SMOKE === '1' || process.env.PHASE3_ALL_METERS_SMOKE === '1') {
      try {
        if (process.env.PHASE2_STARTUP_SMOKE === '1') await require('../test/startup-smoke.cjs')(win)
        else if (process.env.PHASE6_SECURITY_SMOKE === '1') await require('../../phase6/test/security-smoke.cjs')(win)
        else if (process.env.PHASE6_AUDIO_COPY_EDITOR_SMOKE === '1') await require('../../phase6/test/audio-copy-editor-smoke.cjs')(win)
        else if (process.env.PHASE6_PREVIEW_PERF_SMOKE === '1') await require('../../phase6/test/preview-performance-smoke.cjs')(win)
        else if (process.env.PHASE6_REPEAT_SMOKE === '1') await require('../../phase6/test/repeat-smoke.cjs')(win)
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

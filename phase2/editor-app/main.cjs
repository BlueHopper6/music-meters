const { app, BrowserWindow, dialog, ipcMain, Menu, protocol, screen, shell } = require('electron')
const { join, resolve, dirname, basename, extname, isAbsolute } = require('node:path')
const { spawn } = require('node:child_process')
const { Worker } = require('node:worker_threads')
const { randomUUID } = require('node:crypto')
const fs = require('node:fs')
const { prepareStoredMedia, samePath, writeAtomic } = require('../media-storage.cjs')
const { jobPath } = require('../runtime.cjs')
const { resolveProjectAudio, projectAudioReference, isForeignPlatformReference } = require('../project-audio.cjs')
const { buildDarwinMenuTemplate, shouldQuitOnWindowAllClosed } = require('./darwin-platform.cjs')
const { defaultProject, compositionProject, normalizeProject } = require('../project.cjs')
const { encapsulateProjectPath, projectSaveName, projectTitleForSave } = require('../project-path.cjs')
const { readLibraryProject, renameLibraryProject, copyLibraryProject, removeOriginalProject, deleteLibraryProject } = require('../project-library.cjs')
const { installedFonts, assertInstalledFonts } = require('../fonts.cjs')
const { readImage, imagePaths, assetData, saveArtwork, resolveArtwork } = require('../assets.cjs')
const { listTemplates, readTemplate, saveTemplate, duplicateTemplate, renameTemplate, deleteTemplate, applyTemplate, titleSuggestion } = require('../templates.cjs')
const { readPreferences, writePreferences, recordRecentProject, availableRecentProjects, isMissingProject } = require('../preferences.cjs')
const { probeAudio } = require('../audio.cjs')
const { outputFormat, validateOutputPath, validateAudioCopy } = require('../audio-output.cjs')
const { lockWindowNavigation, assertTrustedSender } = require('../window-security.cjs')
const { mediaResponse } = require('../playback-video.cjs')
const { LivePlayback } = require('../live-playback.cjs')
const { videoOf, probeVideo, mediaPlan, copySource, MediaCache, saveVideoReferences, resolveVideoReferences } = require('../project-media.cjs')
const thumbnails = require('../project-thumbnails.cjs')
const { VideoFrames, VideoPreviewCache } = require('../video-frames.cjs')
const mediaCache = new MediaCache(jobPath('media', randomUUID()))
const videoCache = new VideoPreviewCache(jobPath('video-preview', randomUUID()))
const allowedVideos = new Set([''])
protocol.registerSchemesAsPrivileged([{ scheme: 'musicmeters-preview', privileges: { standard: true, secure: true, stream: true } }])

const ROOT = resolve(__dirname, '..', '..')
const AUDIO_EXTENSIONS = new Set(['.wav', '.mp3', '.flac'])
const identity = require('../../phase6/application.cjs')
// productName changes the default Electron profile name. Explicitly retain
// the old packaged profile so portable users keep templates and preferences.
app.setPath('userData', join(app.getPath('appData'), app.isPackaged ? identity.name : app.getName()))
if (process.platform === 'win32') app.setAppUserModelId(identity.appId)
app.setName(identity.productName)
if (process.env.PHASE5_TEST_USER_DATA) {
  app.setPath('userData', process.env.PHASE5_TEST_USER_DATA)
  app.setPath('sessionData', process.env.PHASE5_TEST_USER_DATA)
}
let win
let forceQuit = false
let quitRequested = false
let hasShownSplash = false
let project = defaultProject()
const allowedImages = new Set()

let pendingStorage = null
async function chooseStorage(input, kind) {
  // Existing automated smokes preserve their historical import behavior.
  if ((isAutomatedTest || process.env.PHASE2_STARTUP_SMOKE === '1') && !process.env.MUSICMETERS_STORAGE_SMOKE) return kind === 'image' ? 'copy' : 'link'
  if (pendingStorage) throw new Error('Finish the current import first')
  return new Promise(resolve => {
    const id = randomUUID()
    pendingStorage = { id, resolve }
    win.webContents.send('media-storage-requested', { id, kind, name: basename(input) })
  })
}
let metadata = null
let activeAudio = ''
// Only picker/opened-project paths from this project session may be restored.
const historyAudio = new Set([''])
let projectPath = null
let projectOpen = false
let projectManagementRunning = false
let quitAfterProjectManagement = false
let closeWindowAfterProjectManagement = false
let previewGeneration = 0
let previewAudioRevision = 0
let previewWorker = null
const pendingPreviews = new Map()
let exportJob = null
let closingAfterExport = false
let closingWindowAfterExport = false
let playbackVideo
let playbackRequest = 0
let playbackCleaned = false
let cleaningPlayback = false
const userData = () => app.getPath('userData')
const editorDocument = join(__dirname, 'index.html')

function handle(channel, callback) {
  ipcMain.handle(channel, (event, ...args) => {
    assertTrustedSender(event, win?.webContents, editorDocument)
    if ((projectManagementRunning || pendingStorage) && ['new-blank-project', 'new-project-from-template', 'close-project', 'open-project', 'open-project-path', 'save-project', 'choose-audio', 'choose-video', 'choose-image', 'restore-project', 'media-info', 'load-template', 'render-video', 'render-still'].includes(channel)) {
      throw new Error('Wait for the project operation to finish')
    }
    return callback(event, ...args)
  })
}

handle('media-storage-choice', (_event, id, choice) => {
  if (!pendingStorage || id !== pendingStorage.id || !['copy', 'link', null].includes(choice)) throw new Error('Invalid import choice')
  const pending = pendingStorage
  pendingStorage = null
  pending.resolve(choice)
})

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

const isPresentLocalMedia = file => Boolean(file) && !isForeignPlatformReference(file) && fs.existsSync(file)

function missingMedia(value) {
  const missing = []
  const video = videoOf(value)
  if (video?.videoPath && !isPresentLocalMedia(video.videoPath)) missing.push({ kind: 'video', label: video.name, path: video.videoPath, id: video.id })
  if (value.audioPath && !isPresentLocalMedia(value.audioPath)) missing.push({ kind: 'audio', label: 'Audio', path: value.audioPath })
  if (value.version === 2) {
    if (value.background.type === 'image' && value.background.imagePath && !isPresentLocalMedia(value.background.imagePath)) {
      missing.push({ kind: 'background', label: 'Background image', path: value.background.imagePath })
    }
    for (const layer of value.layers) if (layer.type === 'image' && layer.imagePath && !isPresentLocalMedia(layer.imagePath)) {
      missing.push({ kind: 'layer', id: layer.id, label: layer.name, path: layer.imagePath })
    }
  }
  return missing
}

function suggestedOutput(value, audioMode) {
  const source = value.audioPath || videoOf(value)?.videoPath || ''
  const title = value.title && value.title !== 'Untitled track' ? value.title : titleSuggestion(source)
  const safe = title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').replace(/[. ]+$/g, '').trim().slice(0, 120) || 'visualizer'
  return join(projectPath ? dirname(projectPath) : dirname(source),
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

function validateActiveProject(raw, restoring = false) {
  const normalized = normalizeProject(raw)
  assertInstalledFonts(normalized)
  if (restoring ? !historyAudio.has(normalized.audioPath)
    : normalized.audioPath !== activeAudio && normalized.audioPath !== project.audioPath) {
    throw new Error('Project audio does not match the imported file')
  }
  for (const input of imagePaths(normalized)) if (!allowedImages.has(input)) {
    throw new Error('Choose artwork through the local image picker')
  }
  if (!allowedVideos.has(videoOf(normalized)?.videoPath || '')) throw new Error('Choose video through the local video picker')
  return normalized
}

function availableMediaProject(value) {
  const available = { ...value, audioPath: isPresentLocalMedia(value.audioPath) ? value.audioPath : '',
    layers: value.layers.filter(layer => layer.type !== 'video' || isPresentLocalMedia(layer.videoPath)) }
  const mode = value.mixer?.durationMode
  const missingDurationSource = mode === 'video' && !videoOf(available)?.videoPath || mode === 'audio' && !available.audioPath
  return { ...available, mixer: { ...value.mixer, ...(missingDurationSource ? { durationMode: 'longest' } : {}) } }
}

function currentMediaInfo(value) {
  const available = availableMediaProject(value)
  // Keep missing references in the project; metadata describes available sources.
  if (!available.audioPath && !videoOf(available)?.videoPath) return null
  return mediaPlan(available)?.metadata || null
}
handle('media-info', (_event, raw) => {
  const value = validateActiveProject(raw)
  const plan = mediaPlan(value)
  metadata = plan?.metadata || null
  project = value
  return metadata
})
handle('choose-video', async () => {
  if (exportJob || projectManagementRunning) throw new Error('Wait for the current operation')
  const result = process.env.MUSICMETERS_TEST_VIDEO ? { filePaths: [process.env.MUSICMETERS_TEST_VIDEO] }
    : await dialog.showOpenDialog(win, { title: 'Import video', properties: ['openFile'],
      filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v'] }] })
  if (result.canceled) return null
  const input = resolve(result.filePaths[0]), info = probeVideo(input)
  const storage = await chooseStorage(input, 'video')
  if (!storage) return null
  allowedVideos.add(input)
  return { path: input, storage, ...info }
})
handle('load-videos', async (_event, raw) => {
  const value = validateActiveProject(raw), video = videoOf(value)
  if (!video?.videoPath || !isPresentLocalMedia(video.videoPath)) return {}
  const preview = await videoCache.prepare(video.videoPath)
  return { [video.videoPath]: preview.url }
})
handle('cancel-media-preparation', () => { ++playbackRequest; cancelPreview(); mediaCache.cancel(); videoCache.cancel(); return playbackVideo.cancel() })

const isAutomatedTest = Boolean(
  process.env.MUSICMETERS_THUMBNAIL_SMOKE ||
  process.env.MUSICMETERS_VIDEO_TRANSFORM_SMOKE ||
  process.env.MUSICMETERS_RANGE_SMOKE ||
  process.env.MUSICMETERS_SNAPPING_SMOKE ||
  process.env.MUSICMETERS_FEEDBACK_SMOKE ||
  process.env.MUSICMETERS_STYLE_SMOKE ||
  process.env.MUSICMETERS_STORAGE_SMOKE ||
  process.env.MUSICMETERS_MEDIA_SMOKE ||
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

handle('initial', () => {
  const isStartupSession = !hasShownSplash && (process.env.PHASE2_STARTUP_SMOKE === '1' || !isAutomatedTest)
  hasShownSplash = true
  return {
    platform: process.platform, project, metadata, projectPath, fonts: installedFonts(),
    templates: listTemplates(userData()), preferences: readPreferences(userData()), missingMedia: missingMedia(project),
    isStartupSession,
    isAutomatedTest: Boolean(isAutomatedTest),
  }
})
handle('get-recent-projects', () => availableRecentProjects(userData()))
function assertRecentThumbnailPath(input) {
  if (typeof input !== 'string' || !readPreferences(userData()).recentProjects.some(item => samePath(item.path, input))) throw new Error('Project is not in recent projects')
  return resolve(input)
}
async function thumbnailSource(value, frame) {
  if (!Number.isSafeInteger(frame) || frame < 0 || frame > 2592000) throw new Error('Invalid thumbnail frame')
  let videoFrame = ''
  const layer = videoOf(value)
  if (layer?.videoPath && layer.visible && layer.opacity > 0) {
    if (!isPresentLocalMedia(layer.videoPath)) throw new Error('Choose a local video file')
    const reader = new VideoFrames(layer, 1 / 30, 480, frame / 30)
    try { videoFrame = await reader.read() } finally { await reader.close() }
  }
  return { assets: assetData(value), videoFrame, frame }
}
handle('project-thumbnail-source', (_event, raw, frame) => thumbnailSource(validateActiveProject(raw),frame))
handle('get-project-thumbnail', async (_event, input) => {
  const file = assertRecentThumbnailPath(input), version = thumbnails.projectVersion(file)
  const url = thumbnails.readThumbnail(userData(),file,version)
  if (url) return { url, version }
  const { project: saved } = readLibraryProject(file)
  const layer = videoOf(saved)
  const frame = saved.previewFrame || (layer?.videoPath && isPresentLocalMedia(layer.videoPath) ? Math.round(Math.min(1,probeVideo(layer.videoPath).duration * 0.1)*30) : 0)
  return { project: saved, source: await thumbnailSource(saved,frame), version }
})
handle('cache-project-thumbnail', (_event, input, version, png) => thumbnails.writeThumbnail(userData(),assertRecentThumbnailPath(input),version,png))

function freshBlankProject() {
  const fresh = compositionProject()
  fresh.layers = []
  fresh.title = 'Untitled project'
  return fresh
}
handle('new-blank-project', () => {
  allowedVideos.clear(); allowedVideos.add(''); videoCache.media.clear()
  projectOpen = true
  cancelPreview()
  project = freshBlankProject()
  projectPath = null
  activeAudio = ''
  metadata = null
  allowedImages.clear()
  historyAudio.clear(); historyAudio.add('')
  return { project, metadata, projectPath, fonts: installedFonts(),
    templates: listTemplates(userData()), preferences: readPreferences(userData()), missingMedia: [] }
})
function resetProjectSession() {
  allowedVideos.clear(); allowedVideos.add(''); videoCache.media.clear()
  projectOpen = false
  cancelPreview()
  project = freshBlankProject()
  projectPath = null
  activeAudio = ''
  metadata = null
  allowedImages.clear()
  historyAudio.clear(); historyAudio.add('')
  chosenExportDestination = null
}
handle('close-project', () => {
  resetProjectSession()
  return { project, metadata, projectPath, fonts: installedFonts(),
    templates: listTemplates(userData()), preferences: readPreferences(userData()), missingMedia: [] }
})
handle('new-project-from-template', (_event, templateId) => {
  allowedVideos.clear(); allowedVideos.add(''); videoCache.media.clear()
  if (!templateId || typeof templateId !== 'string') throw new Error('Choose a template')
  cancelPreview()
  const tmpl = readTemplate(userData(), templateId)
  const base = defaultProject()
  base.title = 'Untitled project'
  const applied = applyTemplate(tmpl.layout, base)
  assertInstalledFonts(applied)
  projectOpen = true
  allowedImages.clear()
  for (const input of imagePaths(applied)) allowedImages.add(input)
  project = applied
  historyAudio.clear(); historyAudio.add('')
  projectPath = null
  activeAudio = ''
  metadata = null
  return { project, metadata, projectPath, fonts: installedFonts(),
    templates: listTemplates(userData()), preferences: readPreferences(userData()), missingMedia: missingMedia(project) }
})
handle('list-templates', () => listTemplates(userData()))
handle('template-preview', (_event, id) => {
  if (typeof id !== 'string' || id.length > 120) throw new Error('Invalid template ID')
  const { layout } = readTemplate(userData(), id)
  return { project: layout, assets: assetData(layout, false) }
})
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
  const storage = await chooseStorage(absolute, 'image')
  if (!storage) return null
  allowedImages.add(absolute)
  return { path: absolute, storage }
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
  const storage = await chooseStorage(chosen.path, 'audio')
  if (!storage) return null
  historyAudio.add(chosen.path)
  activeAudio = chosen.path
  metadata = chosen.metadata
  previewAudioRevision++
  cancelPreview()
  project.audioPath = activeAudio
  return { ...chosen, storage }
})
handle('restore-project', async (_event, raw) => {
  if (exportJob) throw new Error('Wait for the export to finish')
  await playbackVideo.cancel()
  const next = validateActiveProject(raw, true)
  cancelPreview()
  previewAudioRevision++
  project = next
  activeAudio = isPresentLocalMedia(next.audioPath) ? next.audioPath : ''
  metadata = currentMediaInfo(next)
  return { project, metadata, missingMedia: missingMedia(project) }
})
handle('preview-at', async (_event, frame, raw) => {
  if (!metadata) throw new Error('Import audio or video before previewing')
  if (!Number.isSafeInteger(frame) || frame < 0 || frame >= metadata.totalFrames) {
    throw new Error('Preview frame is outside the song')
  }
  const value = validateActiveProject(raw)
  cancelPreview()
  const id = previewGeneration
  const prepared = await mediaCache.prepare(availableMediaProject(value))
  if (id !== previewGeneration) return { superseded: true }
  const worker = getPreviewWorker()
  return new Promise((resolve, reject) => {
    pendingPreviews.set(id, { resolve, reject })
    try { worker.postMessage({ type: 'preview', id, input: prepared.analysisPath, metadata: prepared.metadata,
      frame, project: value, audioRevision: `${previewAudioRevision}:${prepared.analysisPath}` }) }
    catch (error) { pendingPreviews.delete(id); reject(error) }
  })
})
handle('cancel-preview', () => cancelPreview())
handle('prepare-playback', async (_event, raw, frame) => {
  if (exportJob) throw new Error('Wait for the export to finish')
  if (!metadata) throw new Error('Import audio or video before playing a preview')
  if (!Number.isSafeInteger(frame) || frame < 0 || frame >= metadata.totalFrames) throw new Error('Playback position is outside the song')
  const value = validateActiveProject(raw)
  assetData(value)
  cancelPreview()
  const generation = ++playbackRequest
  const prepared = await mediaCache.prepare(availableMediaProject(value))
  if (generation !== playbackRequest) return { superseded: true }
  const result = await playbackVideo.open({ ...value, audioPath: prepared.analysisPath }, prepared.metadata, frame, prepared.outputPath)
  return { ...result, peak: prepared.peak }
})
handle('playback-frames', (_event, session, count) => playbackVideo.pull(session, count))
handle('cancel-playback', () => { ++playbackRequest; return playbackVideo.cancel() })
handle('save-project', async (_event, raw, asNew = false, thumbnail) => {
  const value = validateActiveProject(raw)
  if (typeof asNew !== 'boolean') throw new Error('Invalid Save As setting')
  if (thumbnail !== undefined) thumbnails.validateThumbnail(thumbnail)
  let target = process.env.PHASE2_TEST_PROJECT_PATH || (asNew ? null : projectPath)
  if (!target) {
    if (process.env.PHASE2_TEST_SAVE_PATH) {
      target = encapsulateProjectPath(process.env.PHASE2_TEST_SAVE_PATH)
    } else {
      const result = await dialog.showSaveDialog(win, {
        title: asNew ? 'Save project as' : 'Save project',
        defaultPath: projectPath ? join(dirname(projectPath), projectSaveName(value.title)) : projectSaveName(value.title),
        filters: [{ name: 'Visualizer project', extensions: ['json'] }],
      })
      if (result.canceled) return null
      target = encapsulateProjectPath(result.filePath)
    }
  }
  if (extname(target).toLowerCase() !== '.json') throw new Error('Project file must end in .json')
  value.title = projectTitleForSave(value.title, target)
  projectManagementRunning = true
  let savedSuccessfully = false
  try {
    const prepared = await prepareStoredMedia(value, target)
    const reference = prepared.audioPath
    const document = { ...saveVideoReferences(saveArtwork(prepared, target, false), target), audioPath: undefined,
      audioRelativePath: projectAudioReference(target, reference) }
    writeAtomic(target, JSON.stringify(document, null, 2) + '\n')
    project = normalizeProject(resolveVideoReferences(resolveArtwork({ ...document, audioPath: reference }, target), target))
    for (const input of imagePaths(project)) allowedImages.add(input)
    allowedVideos.add(videoOf(project)?.videoPath || '')
    activeAudio = reference; historyAudio.add(reference)
    projectPath = target
    recordRecentProject(userData(), target, project.title)
    if (thumbnail) { try { thumbnails.writeThumbnail(userData(),target,thumbnails.projectVersion(target),thumbnail) } catch (error) { console.warn('Project thumbnail cache could not be updated:',error.message) } }
    savedSuccessfully = true
    return { path: target, project, missingMedia: missingMedia(project) }
  } finally {
    projectManagementRunning = false
    if (quitAfterProjectManagement) {
      quitAfterProjectManagement = false
      if (savedSuccessfully) app.quit()
      else if (win && !win.isDestroyed()) win.close() // A failed save still needs the normal unsaved guard.
    } else if (closeWindowAfterProjectManagement) {
      closeWindowAfterProjectManagement = false
      if (savedSuccessfully) {
        forceQuit = true
        if (win && !win.isDestroyed()) win.close()
      } else if (win && !win.isDestroyed()) {
        win.close()
      }
    }
  }
})
function loadProjectFromDisk(target) {
  if (fs.statSync(target).size > 1024 * 1024) throw new Error('Project file is too large')
  const stored = JSON.parse(fs.readFileSync(target, 'utf8'))
  const candidate = resolveProjectAudio(target, stored.audioRelativePath)
  const value = normalizeProject(resolveVideoReferences(resolveArtwork({ ...stored, audioPath: candidate }, target), target))
  assertInstalledFonts(value)
  allowedImages.clear()
  allowedVideos.clear(); allowedVideos.add(''); allowedVideos.add(videoOf(value)?.videoPath || '')
  for (const input of imagePaths(value)) allowedImages.add(input)
  let nextMetadata = null
  let nextAudio = ''
  if (candidate && isPresentLocalMedia(candidate)) {
    const info = audioInfo(candidate)
    nextMetadata = info.metadata
    nextAudio = info.path
  }
  previewAudioRevision++
  cancelPreview()
  project = value
  projectOpen = true
  historyAudio.clear(); historyAudio.add(''); historyAudio.add(value.audioPath)
  metadata = currentMediaInfo(value)
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

const missingProjectMessage = 'This project can’t be found. It may have been moved or deleted. Use Open project to find it again.'
handle('open-project-path', async (_event, targetPath) => {
  if (typeof targetPath !== 'string' || !isAbsolute(targetPath) || targetPath.length > 4096) {
    throw new Error('Invalid project path')
  }
  const resolved = resolve(targetPath)
  const recent = readPreferences(userData()).recentProjects
  if (!recent.some(item => samePath(item.path, resolved))) {
    throw new Error('Project is not in recent projects')
  }
  if (isMissingProject(resolved)) throw new Error(missingProjectMessage)
  try { return loadProjectFromDisk(resolved) }
  catch (error) {
    if (['ENOENT', 'ENOTDIR'].includes(error.code) && isMissingProject(resolved)) throw new Error(missingProjectMessage)
    throw error
  }
})
handle('manage-project', async (_event, source, action, name = '') => {
  if (projectOpen || exportJob) throw new Error('Close the current project before managing saved projects')
  if (projectManagementRunning) throw new Error('Another project operation is in progress')
  if (typeof source !== 'string' || !isAbsolute(source) || source.length > 4096) throw new Error('Invalid project path')
  if (!['rename', 'move', 'copy', 'delete'].includes(action)) throw new Error('Invalid project action')
  source = resolve(source)
  const recent = readPreferences(userData()).recentProjects
  if (!recent.some(item => samePath(item.path, source))) throw new Error('Project is not in recent projects')
  if (isMissingProject(source)) throw new Error(missingProjectMessage)
  projectManagementRunning = true
  try {
    if (action === 'rename') {
      const renamed = renameLibraryProject(source, name)
      const current = readPreferences(userData())
      writePreferences(userData(), { recentProjects: [{ path: renamed.path, name: renamed.name, lastOpened: Date.now() }, ...current.recentProjects.filter(item => !samePath(item.path, source) && !samePath(item.path, renamed.path))] })
      return { path: renamed.path, name: renamed.name }
    }
    const original = readLibraryProject(source)
    if (action === 'delete') {
      const choice = await dialog.showMessageBox(win, { type: 'warning', title: 'Delete project',
        message: `Delete “${original.project.title || basename(source, '.json')}”?`,
        detail: `${source}\n\nThe project and its recorded copied media will go to the ${process.platform === 'darwin' ? 'Trash' : 'Recycle Bin'}. Original media and unrelated files will be kept.`,
        buttons: ['Cancel', 'Delete project'], defaultId: 0, cancelId: 0, noLink: true })
      if (choice.response !== 1) return null
      const deleted = await deleteLibraryProject(source, folder => shell.trashItem(folder))
      const current = readPreferences(userData())
      writePreferences(userData(), { recentProjects: current.recentProjects.filter(item => !samePath(item.path, source)) })
      return deleted
    }
    const folder = dirname(source)
    const parent = basename(folder).toLowerCase() === basename(source, '.json').toLowerCase() ? dirname(folder) : folder
    const displayName = original.project.title.trim() || basename(source, '.json')
    const proposedName = action === 'copy' ? displayName + ' copy' : displayName
    const choice = await dialog.showSaveDialog(win, {
      title: action === 'move' ? 'Move project to' : 'Copy project to',
      defaultPath: join(parent, projectSaveName(proposedName)),
      filters: [{ name: 'Visualizer project', extensions: ['json'] }],
    })
    if (choice.canceled) return null
    const target = encapsulateProjectPath(choice.filePath)
    const title = action === 'copy' ? basename(target, '.json') : displayName
    const copied = await copyLibraryProject(source, target, title, entry => recordRecentProject(userData(), entry.path, entry.name))
    if (action === 'move') {
      try { removeOriginalProject(copied) }
      catch (error) { throw new Error(`Copy is available at ${target}. Move did not finish: ${error.message}`) }
      const current = readPreferences(userData())
      writePreferences(userData(), { recentProjects: current.recentProjects.filter(item => !samePath(item.path, source)) })
    }
    return { path: copied.path, name: copied.name }
  } catch (error) {
    if (['ENOENT', 'ENOTDIR'].includes(error.code) && isMissingProject(source)) throw new Error(missingProjectMessage)
    throw error
  } finally {
    projectManagementRunning = false
    if (quitAfterProjectManagement) { quitAfterProjectManagement = false; app.quit() }
    else if (closeWindowAfterProjectManagement) {
      closeWindowAfterProjectManagement = false
      forceQuit = true
      if (win && !win.isDestroyed()) win.close()
    }
  }
})
let chosenExportDestination = null
async function chooseExportDestination(value, audioMode) {
  const format = outputFormat(audioMode)
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
  chosenExportDestination = { output, audioMode }
  return output
}
handle('choose-export-destination', async (_event, raw, audioMode) => {
  if (exportJob) throw new Error('An export is already running')
  if (!metadata) throw new Error('Import audio or video before exporting')
  const value = validateActiveProject(raw)
  if (audioMode === 'copy') { const source = copySource(value); validateAudioCopy(source.path, source.metadata) }
  return chooseExportDestination(value, audioMode)
})
handle('render-video', async (_event, raw, preset, audioMode, destination = '', selectedRange) => {
  if (exportJob) throw new Error('An export is already running')
  if (!metadata) throw new Error('Import audio or video before rendering')
  if (!['720p', '1080p', '1440p', '2160p'].includes(preset)) throw new Error('Unsupported export preset')
  outputFormat(audioMode)
  const value = validateActiveProject(raw)
  const { exportRange, assertRangeAudioMode } = require('../export-range.cjs')
  const range = exportRange(selectedRange, mediaPlan(value).metadata.duration)
  assertRangeAudioMode(range, audioMode)
  if (audioMode === 'copy') { const source = copySource(value); validateAudioCopy(source.path, source.metadata) }
  assetData(value)
  writePreferences(userData(), { exportPreset: preset })
  let output
  if (destination) {
    if (typeof destination !== 'string' || destination !== chosenExportDestination?.output || audioMode !== chosenExportDestination.audioMode) {
      throw new Error('Choose an export destination through the save dialog')
    }
    output = destination
  } else output = await chooseExportDestination(value, audioMode)
  if (!output) return null
  if (exportJob) throw new Error('An export is already running')
  output = resolve(output)
  validateOutputPath(output, audioMode)
  if (fs.existsSync(output)) throw new Error(`Output already exists: ${output}`)
  return launchExport(value, output, preset, audioMode, range)
})
handle('render-still', async (_event, raw, preset, frame) => {
  if (exportJob) throw new Error('An export is already running')
  if (!['720p','1080p','1440p','2160p'].includes(preset)) throw new Error('Unsupported export preset')
  const value = validateActiveProject(raw)
  const { validateStillOutput, validateStillFrame } = require('../still-output.cjs')
  validateStillFrame(frame, mediaPlan(value)?.metadata)
  assetData(value)
  const result = process.env.MUSICMETERS_TEST_STILL_OUTPUT
    ? { filePath: process.env.MUSICMETERS_TEST_STILL_OUTPUT }
    : await dialog.showSaveDialog(win, { title: 'Export current frame as PNG',
      defaultPath: suggestedOutput(value, 'aac').replace(/\.mp4$/i, `_frame-${frame}.png`),
      filters: [{ name: 'PNG image', extensions: ['png'] }] })
  if (result.canceled) return null
  let output = resolve(result.filePath)
  if (!extname(output)) output += '.png'
  validateStillOutput(output)
  if (fs.existsSync(output)) throw new Error('That PNG already exists. Choose a different filename.')
  if (exportJob) throw new Error('An export is already running')
  return launchExport(value, output, preset, undefined, undefined, frame)
})
function launchExport(value, output, preset, audioMode, range, stillFrame) {
  const controlDir = jobPath('jobs')
  fs.mkdirSync(controlDir, { recursive: true })
  const cancelFile = join(controlDir, `${randomUUID()}.cancel`)
  const exportProfile = fs.mkdtempSync(join(controlDir, 'export-profile-'))
  const child = spawn(process.execPath, [join(ROOT, 'phase2', 'export-app')], {
    env: { ...process.env, MUSICMETERS_EXPORT_PROFILE: exportProfile,
      PHASE2_JOB: JSON.stringify({ project: value, output, cancelFile, preset, audioMode, range, stillFrame }) },
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
  child.once('close', async code => {
    fs.rmSync(cancelFile, { force: true })
    try { await fs.promises.rm(exportProfile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) }
    catch (error) { console.error(`Could not remove temporary exporter profile: ${error.message}`) }
    exportJob = null
    if (job.errors.trim()) console.error(`Exporter diagnostics:\n${job.errors.trim()}`)
    if (code === 0 && job.finishedEvent) sendExport(job.finishedEvent)
    else sendExport({ event: code === 2 ? 'cancelled' : 'failed',
      message: code === 2 ? 'Export cancelled' : job.errors.trim() || `Exporter exited ${code}`, output })
    if (closingAfterExport) app.quit()
    else if (closingWindowAfterExport) {
      closingWindowAfterExport = false
      forceQuit = true
      if (win && !win.isDestroyed()) win.close()
    }
  })
  return output
}
handle('confirm-app-close', () => {
  if (process.platform === 'darwin' && !quitRequested && exportJob) {
    closingWindowAfterExport = true
    fs.writeFileSync(exportJob.cancelFile, 'cancel')
    return
  }
  forceQuit = true
  if (win && !win.isDestroyed()) win.close()
  if (quitRequested) app.quit()
})
handle('cancel-app-close', () => {
  quitRequested = false
  forceQuit = false
  closingAfterExport = false
  closingWindowAfterExport = false
  quitAfterProjectManagement = false
  closeWindowAfterProjectManagement = false
})
let restoreBounds = null
function defaultEditorBounds(targetWin = win) {
  if (process.platform !== 'darwin') return { width: 1480, height: 900 }
  const display = (targetWin && !targetWin.isDestroyed() ? screen.getDisplayMatching(targetWin.getBounds()) : null) || screen.getPrimaryDisplay()
  const area = display.workArea
  const width = area.width > 1520 ? 1480 : Math.max(1000, area.width - 20)
  const height = area.height > 940 ? 900 : Math.max(700, area.height - 20)
  const x = area.x + Math.max(0, Math.floor((area.width - width) / 2))
  const y = area.y + Math.max(0, Math.floor((area.height - height) / 2))
  return { x, y, width, height }
}
function maximizeEditorWindow(targetWin = win) {
  if (!targetWin || targetWin.isDestroyed()) return
  const current = targetWin.getBounds()
  const display = screen.getDisplayMatching(current) || screen.getPrimaryDisplay()
  if (current.width < display.workArea.width || current.height < display.workArea.height) {
    restoreBounds = current
  } else if (!restoreBounds) {
    restoreBounds = defaultEditorBounds(targetWin)
  }
  targetWin.maximize()
  if (process.platform === 'darwin' && !targetWin.isMaximized()) {
    targetWin.setBounds(display.workArea)
  }
  targetWin.webContents.send('window-state', windowState())
}

handle('toggle-window-fullscreen', () => {
  if (win && !win.isDestroyed()) win.setFullScreen(!win.isFullScreen())
})
const windowState = () => ({ fullscreen: Boolean(win && !win.isDestroyed() && win.isFullScreen()), maximized: Boolean(win && !win.isDestroyed() && win.isMaximized()) })
handle('window-state', windowState)
handle('minimize-window', () => { if (win && !win.isDestroyed()) win.minimize() })
handle('maximize-window', () => {
  if (!win || win.isDestroyed()) return
  if (win.isFullScreen()) win.setFullScreen(false)
  else if (win.isMaximized()) {
    win.unmaximize()
    if (process.platform === 'darwin' && win.isMaximized()) {
      win.setBounds(restoreBounds || defaultEditorBounds(win))
    }
    win.webContents.send('window-state', windowState())
  } else maximizeEditorWindow(win)
})
handle('close-window', (_event, quitApp = false) => {
  if (quitApp) quitRequested = true
  if (win && !win.isDestroyed()) win.close()
  else if (quitApp) app.quit()
})
handle('cancel-render', () => {
  if (exportJob) fs.writeFileSync(exportJob.cancelFile, 'cancel')
})

function sendMenuCommand(command) {
  if (!win || win.isDestroyed()) {
    void createWindow(command)
    return
  }
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
  win.webContents.send('menu-command', command)
}

function createWindow(initialMenuCommand = '') {
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    if (initialMenuCommand) win.webContents.send('menu-command', initialMenuCommand)
    return Promise.resolve(win)
  }
  forceQuit = false
  closingWindowAfterExport = false
  closeWindowAfterProjectManagement = false
  const initialBounds = defaultEditorBounds(null)
  const created = new BrowserWindow({
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    ...(process.platform === 'darwin' ? { trafficLightPosition: { x: 14, y: 12 }, x: initialBounds.x, y: initialBounds.y } : {}),
    backgroundColor: '#09090b',
    width: initialBounds.width, height: initialBounds.height, minWidth: 1000, minHeight: 700,
    icon: join(__dirname, 'assets', 'brand', process.platform === 'darwin' ? 'icon-64.png' : 'music-meters.ico'),
    show: false,
    webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true,
      nodeIntegration: false, sandbox: true, backgroundThrottling: false },
  })
  win = created
  created.once('ready-to-show', () => {
    if (process.env.PHASE2_HEADLESS !== '1' && !created.isDestroyed()) {
      if (process.platform === 'darwin') {
        created.show()
        maximizeEditorWindow(created)
      } else {
        created.maximize()
        created.show()
      }
    }
  })
  if (process.platform !== 'darwin') {
    created.setMenuBarVisibility(false)
    created.setMenu(null)
  }
  for (const event of ['enter-full-screen', 'leave-full-screen', 'maximize', 'unmaximize']) {
    created.on(event, () => {
      if (!created.isDestroyed()) created.webContents.send('window-state', windowState())
    })
  }
  lockWindowNavigation(created.webContents)
  created.webContents.on('render-process-gone', () => {
    if (pendingStorage) { const pending = pendingStorage; pendingStorage = null; pending.resolve(null) }
  })
  created.on('closed', () => {
    if (pendingStorage) { const pending = pendingStorage; pendingStorage = null; pending.resolve(null) }
    if (win === created) win = null
    if (process.platform === 'darwin' && !quitRequested) {
      forceQuit = false
      closingWindowAfterExport = false
      closeWindowAfterProjectManagement = false
      ++playbackRequest
      void playbackVideo?.cancel()
      mediaCache.cancel()
      resetProjectSession()
    }
  })
  created.on('close', event => {
    if (projectManagementRunning) {
      event.preventDefault()
      if (process.platform === 'darwin' && !quitRequested) closeWindowAfterProjectManagement = true
      else quitAfterProjectManagement = true
      return
    }
    if (forceQuit || (isAutomatedTest && process.env.MUSICMETERS_MACOS_LIFECYCLE_SMOKE !== '1')) return
    event.preventDefault()
    created.webContents.send('app-close-requested')
  })
  return created.loadFile(editorDocument).then(() => {
    if (initialMenuCommand && !created.isDestroyed()) {
      created.webContents.send('menu-command', initialMenuCommand)
    }
    return created
  })
}

app.disableHardwareAcceleration()
app.whenReady().then(() => {
  playbackVideo = new LivePlayback()
  protocol.handle('musicmeters-preview', request => mediaResponse(request, videoCache.media.get(request.url) || playbackVideo.media))
  if (process.env.PHASE2_TEST_INPUT) {
    const info = audioInfo(process.env.PHASE2_TEST_INPUT)
    activeAudio = info.path
    metadata = info.metadata
    project.audioPath = activeAudio
    historyAudio.add(activeAudio)
    projectOpen = true
    previewAudioRevision++
  }
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(Menu.buildFromTemplate(buildDarwinMenuTemplate({
      appName: identity.productName,
      onCommand: sendMenuCommand,
      onRequestQuit: () => {
        quitRequested = true
        if (win && !win.isDestroyed()) win.close()
        else app.quit()
      },
      onRequestCloseWindow: () => {
        if (win && !win.isDestroyed()) win.close()
      },
      onToggleFullScreen: () => {
        if (win && !win.isDestroyed()) win.setFullScreen(!win.isFullScreen())
      },
    })))
  }
  return createWindow().then(async () => {
    if (process.env.MUSICMETERS_THUMBNAIL_SMOKE === '1' || process.env.MUSICMETERS_VIDEO_TRANSFORM_SMOKE === '1' || process.env.MUSICMETERS_RANGE_SMOKE === '1' || process.env.MUSICMETERS_FEEDBACK_SMOKE === '1' || process.env.MUSICMETERS_SNAPPING_SMOKE === '1' || process.env.MUSICMETERS_STYLE_SMOKE === '1' || process.env.MUSICMETERS_STORAGE_SMOKE === '1' || process.env.MUSICMETERS_MEDIA_SMOKE === '1' || process.env.PHASE2_PLAYBACK_SMOKE === '1' || process.env.PHASE2_PORTRAIT_SMOKE === '1' || process.env.PHASE2_STARTUP_SMOKE === '1' || process.env.PHASE6_SECURITY_SMOKE === '1' || process.env.PHASE6_AUDIO_COPY_EDITOR_SMOKE === '1' || process.env.PHASE6_PREVIEW_PERF_SMOKE === '1' || process.env.PHASE6_REPEAT_SMOKE === '1' || process.env.PHASE5_RELINK_SMOKE === '1' || process.env.PHASE5_WORKFLOW_SMOKE === '1' || process.env.PHASE4_LEGACY_SMOKE === '1' || process.env.PHASE4_COMPOSITION_SMOKE === '1' || process.env.PHASE2_SMOKE === '1' || process.env.PHASE2_LONG_PREVIEW === '1' || process.env.PHASE2_MISSING_SMOKE === '1' || process.env.PHASE3_SPECTRUM_SMOKE === '1' || process.env.PHASE3_OSCILLOSCOPE_SMOKE === '1' || process.env.PHASE3_OSCILLOSCOPE_LONG === '1' || process.env.PHASE3_SPECTROGRAM_SMOKE === '1' || process.env.PHASE3_WAVEFORM_SMOKE === '1' || process.env.PHASE3_VU_SMOKE === '1' || process.env.PHASE3_LOUDNESS_SMOKE === '1' || process.env.PHASE3_WATERFALL_SMOKE === '1' || process.env.PHASE3_VECTORSCOPE_SMOKE === '1' || process.env.PHASE3_ALL_METERS_SMOKE === '1') {
      try {
        if (process.env.MUSICMETERS_THUMBNAIL_SMOKE === '1') await require('../test/project-thumbnails-smoke.cjs')(win)
        else if (process.env.MUSICMETERS_VIDEO_TRANSFORM_SMOKE === '1') await require('../test/video-transform-smoke.cjs')(win)
        else if (process.env.MUSICMETERS_RANGE_SMOKE === '1') await require('../test/export-range-smoke.cjs')(win)
        else if (process.env.MUSICMETERS_SNAPPING_SMOKE === '1') await require('../test/layer-snapping-smoke.cjs')(win)
        else if (process.env.MUSICMETERS_FEEDBACK_SMOKE === '1') await require('../test/user-feedback-smoke.cjs')(win)
        else if (process.env.MUSICMETERS_STYLE_SMOKE === '1') await require('../test/meter-style-smoke.cjs')(win)
        else if (process.env.MUSICMETERS_STORAGE_SMOKE === '1') await require('../test/media-storage-smoke.cjs')(win)
        else if (process.env.MUSICMETERS_MEDIA_SMOKE === '1') await require('../test/media-quality-smoke.cjs')(win)
        else if (process.env.PHASE2_PLAYBACK_SMOKE === '1') await require('../test/playback-smoke.cjs')(win, playbackVideo)
        else if (process.env.PHASE2_PORTRAIT_SMOKE === '1') await require('../test/portrait-smoke.cjs')(win)
        else if (process.env.PHASE2_STARTUP_SMOKE === '1') await require('../test/startup-smoke.cjs')(win)
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
app.on('activate', () => {
  if (!win || win.isDestroyed()) {
    void createWindow()
    return
  }
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
})
app.on('window-all-closed', () => {
  if (shouldQuitOnWindowAllClosed({
    platform: process.platform,
    quitRequested,
    isAutomatedTest,
    lifecycleSmoke: process.env.MUSICMETERS_MACOS_LIFECYCLE_SMOKE === '1',
  })) {
    app.quit()
  }
})
app.on('before-quit', event => {
  quitRequested = true
  if (win && !win.isDestroyed() && !forceQuit && !(isAutomatedTest && process.env.MUSICMETERS_MACOS_LIFECYCLE_SMOKE !== '1')) {
    event.preventDefault()
    win.close()
    return
  }
  if (projectManagementRunning) { event.preventDefault(); quitAfterProjectManagement = true; return }
  if (exportJob) {
    event.preventDefault()
    closingAfterExport = true
    fs.writeFileSync(exportJob.cancelFile, 'cancel')
    return
  }
  if (!playbackCleaned) {
    event.preventDefault()
    if (!cleaningPlayback) {
      cleaningPlayback = true
      mediaCache.cancel(); videoCache.cancel()
      Promise.resolve(playbackVideo?.cancel()).catch(error => console.error(`Preview cleanup: ${error.message}`))
        .then(async () => { await previewWorker?.terminate(); await mediaCache.close(); await videoCache.close() })
        .catch(error => console.error(`Media cleanup: ${error.message}`))
        .finally(() => { playbackCleaned = true; app.quit() })
    }
  }
})

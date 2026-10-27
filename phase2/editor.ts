import { Composition, decodeAnalysis, type AnalysisFrame, type Project, type VectorscopeLayer, type SpectrumLayer,
  type OscilloscopeLayer, type SpectrogramLayer, type WaveformLayer, type VuLayer, type LoudnessLayer, type WaterfallLayer,
  type ImageLayer, type TextLayer, type Background } from './composition'
import { defaultProject, vectorscopeLayer, spectrumLayer, oscilloscopeLayer, spectrogramLayer, waveformLayer, vuLayer, loudnessLayer, waterfallLayer, imageLayer, textLayer, normalizeProject, fitLayer, orientProject, exportDimensions } from './project.cjs'
import { move as moveOnStage, resize as resizeOnStage } from './stage-geometry.cjs'

type Metadata = { channels: number; sampleRate: number; duration: number; totalFrames: number; codecName: string }
type TemplateEntry = { id: string; name: string; builtIn: boolean }
type MissingMedia = { kind: 'audio' | 'background' | 'layer'; id?: string; label: string; path: string }
type RecentProject = { path: string; name: string; lastOpened: number }
type Initial = { project: Project; metadata: Metadata | null; projectPath: string | null; fonts: string[];
  templates: TemplateEntry[]; preferences: { exportPreset: string; lastTemplateId: string; recentProjects?: RecentProject[] };
  missingMedia: MissingMedia[]; isStartupSession?: boolean; isAutomatedTest?: boolean }
type Desktop = {
  toggleWindowFullscreen(): Promise<void>
  minimizeWindow(): Promise<void>
  maximizeWindow(): Promise<void>
  closeWindow(): Promise<void>
  windowState(): Promise<{ fullscreen: boolean; maximized: boolean }>
  onWindowState(listener: (state: { fullscreen: boolean; maximized: boolean }) => void): () => void
  initial(): Promise<Initial>
  chooseAudio(): Promise<{ path: string; metadata: Metadata } | null>
  chooseImage(): Promise<string | null>
  loadAssets(project: Project): Promise<Record<string, string>>
  previewAt(frame: number, project: Project): Promise<
    { x: string; y: string; multiband: string; spectra: Record<string, { mid: string; side: string }>;
      oscilloscopes: Record<string, { samples: string; detectedPitch: number; triggerIndex: number }>;
      spectrograms: Record<string, { rebuild: boolean; entries: Array<{
        columnCount: number; rowCount: number; display: string; heat: string }> }>;
      waveforms: Record<string, { rebuild: boolean; entries: Array<{ columns: number; summary: string }> }>;
      vus: Record<string, { rebuild: boolean; startFrame: number; values: string }>;
      loudness: Record<string, string>;
      waterfalls: Record<string, { columns: number; audioSeconds: number; levels: string; ages: string; frequencies: string }>;
      sampleRate: number; frameIndex: number; superseded?: false }
    | { superseded: true }>
  cancelPreview(): Promise<void>
  saveProject(project: Project, asNew?: boolean): Promise<{ path: string; project: Project; missingMedia: MissingMedia[] } | null>
  openProject(): Promise<Initial | null>
  openProjectPath(path: string): Promise<Initial | null>
  newBlankProject(): Promise<Initial>
  newProjectFromTemplate(id: string): Promise<Initial>
  closeProject(): Promise<Initial>
  getRecentProjects(): Promise<RecentProject[]>
  listTemplates(): Promise<TemplateEntry[]>
  saveTemplate(name: string, project: Project, overwriteId?: string): Promise<TemplateEntry>
  loadTemplate(id: string, project: Project): Promise<{ project: Project; missingMedia: MissingMedia[] }>
  duplicateTemplate(id: string, name?: string): Promise<TemplateEntry>
  renameTemplate(id: string, name: string): Promise<TemplateEntry>
  deleteTemplate(id: string): Promise<{ id: string; name: string }>
  setExportPreset(preset: string): Promise<void>
  renderVideo(project: Project, preset: string, audioMode: string): Promise<string | null>
  cancelRender(): Promise<void>
  confirmAppClose(): Promise<void>
  onAppCloseRequested(listener: () => void): () => void
  onExport(listener: (event: Record<string, unknown>) => void): () => void
}
declare global { interface Window { desktop: Desktop } }

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T
const canvas = $<HTMLCanvasElement>('stage')
const composition = new Composition(canvas)
const selection = $<HTMLDivElement>('selection')
const stageWrap = $<HTMLDivElement>('stage-wrap')
const status = $<HTMLDivElement>('status')
let project = defaultProject() as Project
let metadata: Metadata | null = null
const emptyAnalysis = (): AnalysisFrame => ({ vectorscope: { x: new Float32Array(0), y: new Float32Array(0), multiband: new Float32Array(0) },
  spectra: {}, oscilloscopes: {}, spectrograms: {}, waveforms: {}, vus: {}, loudness: {}, waterfalls: {} })
let analysis = emptyAnalysis()
let sampleRate = 48000
let frameIndex = 0
let selectedId: string | null = project.layers[0]?.id || null
let previewRequest = 0
let previewTimer: ReturnType<typeof setTimeout> | null = null
let exportRunning = false
let projectPath: string | null = null
let missingMedia: MissingMedia[] = []
let templates: TemplateEntry[] = []
let resolveTemplateConflict: ((choice: 'replace' | 'rename') => void) | null = null
let managerEditingId: string | null = null
let managerDeletingId: string | null = null
let isAutomatedTestSession = false

function selected() { return project.layers.find(layer => layer.id === selectedId) }
function selectLayer(id: string | null) {
  if (selectedId === id) return
  selectedId = id
  refreshInspector(); refreshLayers(); updateSelection()
}
function setStatus(message: string) {
  status.textContent = message
  if (!$('project-manager-screen').hidden) {
    const managerStatus = $('project-manager-status')
    managerStatus.textContent = message
    managerStatus.hidden = !message
  }
}
function background(): Background { return project.background as Background }
function upgradeProject() {
  if (project.version === 2) return
  if (project.layers.length >= 32) throw new Error('Remove one layer before enabling composition graphics')
  const oldColor = project.background as string
  project.version = 2
  project.background = { type: 'solid', color: oldColor, color2: '#243750', imagePath: '', fit: 'cover' }
  const title = textLayer(nextId('title'), 'Song title', project.title) as TextLayer
  title.x = 80; title.y = 54; title.h = 72
  project.layers.push(title)
}
async function syncAssets() {
  try { await composition.setAssets(await window.desktop.loadAssets(project)); render() }
  catch (error) { setStatus(`Artwork unavailable: ${String(error)}`); render() }
}
let savedProjectSnapshot = ''
let pendingUnsavedAction: (() => void | Promise<void>) | null = null

function snapshotProject(p: Project): string {
  return JSON.stringify(p)
}

function markProjectSaved() {
  savedProjectSnapshot = snapshotProject(project)
  updateTitleDirtyIndicator()
}

function isProjectDirty(): boolean {
  if (!savedProjectSnapshot) return false
  return snapshotProject(project) !== savedProjectSnapshot
}

function updateTitleDirtyIndicator() {
  const inProject = $('project-manager-screen').hidden && $('splash-screen').hidden
  $('window-project-title').hidden = !inProject
  if (!inProject) {
    $('window-project-title').textContent = ''
    document.title = 'MusicMeters'
    return
  }
  const dirty = isProjectDirty()
  const baseTitle = project.title || 'Untitled track'
  $('window-project-title').textContent = `${baseTitle}${dirty ? ' •' : ''}`
  document.title = dirty ? `MusicMeters — ${baseTitle} *` : `MusicMeters — ${baseTitle}`
}

function confirmDiscardIfDirty(onProceed: () => void | Promise<void>) {
  if (!isProjectDirty()) {
    return Promise.resolve(onProceed())
  }
  pendingUnsavedAction = onProceed
  const modal = $<HTMLDivElement>('unsaved-changes-modal')
  const message = $('unsaved-changes-message')
  const title = project.title || 'Untitled track'
  message.textContent = `You have unsaved changes in "${title}". Do you want to save before closing?`
  modal.hidden = false
  $('unsaved-changes-save').focus()
}

function closeUnsavedChangesModal() {
  $<HTMLDivElement>('unsaved-changes-modal').hidden = true
  pendingUnsavedAction = null
}

function render() {
  if (canvas.width !== project.width || canvas.height !== project.height) {
    canvas.width = project.width; canvas.height = project.height
    composition.dispose()
  }
  stageWrap.style.setProperty('--stage-ratio', String(project.width / project.height))
  ;($<HTMLSelectElement>('canvas-orientation')).value = project.width < project.height ? 'portrait' : 'landscape'
  ;($<HTMLInputElement>('layer-x')).max = String(project.width)
  ;($<HTMLInputElement>('layer-w')).max = String(project.width)
  ;($<HTMLInputElement>('layer-y')).max = String(project.height)
  ;($<HTMLInputElement>('layer-h')).max = String(project.height)
  refreshExportResolution()
  composition.render(project, analysis, frameIndex, sampleRate)
  updateSelection()
  updateTitleDirtyIndicator()
}
function updateSelection() {
  const layer = selected()
  const minimum = layer?.type === 'text' ? 20 : layer?.type === 'image' ? 40 : 80
  ;($<HTMLInputElement>('layer-w')).min = String(minimum)
  ;($<HTMLInputElement>('layer-h')).min = String(minimum)
  selection.hidden = !layer || !layer.visible
  if (!layer) return
  selection.style.left = `${layer.x / project.width * 100}%`
  selection.style.top = `${layer.y / project.height * 100}%`
  selection.style.width = `${layer.w / project.width * 100}%`
  selection.style.height = `${layer.h / project.height * 100}%`
  selection.style.transform = `rotate(${layer.rotation}deg)`
  selection.classList.toggle('locked', layer.locked)
  selection.querySelector('.selection-label')!.textContent = layer.name
}
function layerIconSvg(type: Project['layers'][number]['type']): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(ns, 'svg')
  svg.setAttribute('viewBox', '0 0 16 16')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '1.35')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  const back = document.createElementNS(ns, 'path')
  back.setAttribute('d', 'M4.2 14.8H13.1C14 14.8 14.8 14 14.8 13.1V4.2')
  back.setAttribute('opacity', '0.65')
  const card = document.createElementNS(ns, 'rect')
  card.setAttribute('x', '1.2')
  card.setAttribute('y', '1.2')
  card.setAttribute('width', '11')
  card.setAttribute('height', '11')
  card.setAttribute('rx', '1.8')
  svg.append(back, card)
  if (type === 'image') {
    const sun = document.createElementNS(ns, 'circle')
    sun.setAttribute('cx', '4.6')
    sun.setAttribute('cy', '4.5')
    sun.setAttribute('r', '1')
    sun.setAttribute('fill', 'currentColor')
    sun.setAttribute('stroke', 'none')
    const mountain = document.createElementNS(ns, 'path')
    mountain.setAttribute('d', 'M2 10.3L5.4 6.8L7.8 9.1L9.6 7.3L11.6 9.9')
    svg.append(sun, mountain)
  } else if (type === 'text') {
    const glyph = document.createElementNS(ns, 'path')
    glyph.setAttribute('d', 'M3.9 4H9.5M6.7 4V9.6M5.2 9.6H8.2')
    svg.append(glyph)
  } else {
    const wave = document.createElementNS(ns, 'path')
    wave.setAttribute('d', 'M3.4 5.6V7.8M5 3.9V9.5M6.7 2.8V10.6M8.4 4.3V9.1M10 5.5V7.9')
    svg.append(wave)
  }
  return svg
}
function layerFlagIconSvg(kind: 'visible' | 'hidden' | 'unlocked' | 'locked'): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(ns, 'svg')
  svg.setAttribute('viewBox', '0 0 16 16')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '1.4')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  if (kind === 'visible' || kind === 'hidden') {
    const eye = document.createElementNS(ns, 'path')
    eye.setAttribute('d', 'M1.6 8C3 5.1 5.3 3.6 8 3.6C10.7 3.6 13 5.1 14.4 8C13 10.9 10.7 12.4 8 12.4C5.3 12.4 3 10.9 1.6 8Z')
    const pupil = document.createElementNS(ns, 'circle')
    pupil.setAttribute('cx', '8')
    pupil.setAttribute('cy', '8')
    pupil.setAttribute('r', '1.9')
    svg.append(eye, pupil)
    if (kind === 'hidden') {
      const slash = document.createElementNS(ns, 'path')
      slash.setAttribute('d', 'M2.4 13.6L13.6 2.4')
      svg.append(slash)
    }
  } else {
    const body = document.createElementNS(ns, 'rect')
    body.setAttribute('x', '3.3')
    body.setAttribute('y', '7.2')
    body.setAttribute('width', '9.4')
    body.setAttribute('height', '6.6')
    body.setAttribute('rx', '1.5')
    const shackle = document.createElementNS(ns, 'path')
    shackle.setAttribute('d', kind === 'locked'
      ? 'M5.3 7.2V5C5.3 3.5 6.5 2.3 8 2.3C9.5 2.3 10.7 3.5 10.7 5V7.2'
      : 'M5.3 7.2V4.8C5.3 3.3 6.5 2.1 8 2.1C9.2 2.1 10.2 2.8 10.6 3.9')
    svg.append(body, shackle)
  }
  return svg
}
function layerGripSvg(): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(ns, 'svg')
  svg.setAttribute('viewBox', '0 0 10 14')
  svg.setAttribute('fill', 'currentColor')
  svg.setAttribute('aria-hidden', 'true')
  for (const [cx, cy] of [[3, 3], [7, 3], [3, 7], [7, 7], [3, 11], [7, 11]] as const) {
    const dot = document.createElementNS(ns, 'circle')
    dot.setAttribute('cx', String(cx))
    dot.setAttribute('cy', String(cy))
    dot.setAttribute('r', '1')
    svg.append(dot)
  }
  return svg
}
let layerDrag: {
  id: string; pointerId: number; startY: number; active: boolean
  targetId: string | null; position: 'before' | 'after' | null
} | null = null
let suppressNextLayerClick = false
function clearLayerDropClasses() {
  $('layers').classList.remove('layers-dragging')
  for (const el of Array.from($('layers').querySelectorAll('.layer-item'))) {
    el.classList.remove('is-dragging', 'drop-before', 'drop-after')
  }
}
function refreshLayers() {
  const list = $('layers')
  list.replaceChildren()
  for (const layer of [...project.layers].reverse()) {
    const row = document.createElement('div')
    row.className = `layer-item${layer.id === selectedId ? ' selected' : ''}${layer.visible ? '' : ' is-hidden'}`
    row.dataset.id = layer.id
    row.tabIndex = 0
    row.setAttribute('role', 'button')
    row.setAttribute('aria-pressed', String(layer.id === selectedId))
    const grip = document.createElement('span')
    grip.className = 'layer-grip'
    grip.title = 'Drag to reorder layer'
    grip.append(layerGripSvg())
    const icon = document.createElement('span')
    icon.className = 'layer-icon'
    icon.append(layerIconSvg(layer.type))
    const name = document.createElement('span')
    name.className = 'layer-name'
    name.textContent = layer.name
    const flags = document.createElement('span')
    flags.className = 'layer-flags'
    const visBtn = document.createElement('button')
    visBtn.type = 'button'
    visBtn.className = `layer-flag layer-flag-visibility ${layer.visible ? 'layer-flag-visible' : 'layer-flag-hidden'}`
    visBtn.title = layer.visible ? 'Hide layer' : 'Show layer'
    visBtn.setAttribute('aria-label', layer.visible ? `Hide ${layer.name}` : `Show ${layer.name}`)
    visBtn.setAttribute('aria-pressed', String(!layer.visible))
    visBtn.append(layerFlagIconSvg(layer.visible ? 'visible' : 'hidden'))
    visBtn.addEventListener('click', event => {
      event.stopPropagation()
      layer.visible = !layer.visible
      repaint()
      if ((layer.type === 'spectrogram' || layer.type === 'waveform' || layer.type === 'vu' || layer.type === 'loudness' || layer.type === 'waterfall' || (layer.type === 'vectorscope' && layer.multiband)) && layer.visible) markPreviewStale()
    })
    const lockBtn = document.createElement('button')
    lockBtn.type = 'button'
    lockBtn.className = `layer-flag layer-flag-lock ${layer.locked ? 'layer-flag-locked' : 'layer-flag-unlocked'}`
    lockBtn.title = layer.locked ? 'Unlock layer' : 'Lock layer'
    lockBtn.setAttribute('aria-label', layer.locked ? `Unlock ${layer.name}` : `Lock ${layer.name}`)
    lockBtn.setAttribute('aria-pressed', String(layer.locked))
    lockBtn.append(layerFlagIconSvg(layer.locked ? 'locked' : 'unlocked'))
    lockBtn.addEventListener('click', event => {
      event.stopPropagation()
      layer.locked = !layer.locked
      repaint()
    })
    flags.append(visBtn, lockBtn)
    row.append(grip, icon, name, flags)
    const selectRowLayer = () => {
      if (suppressNextLayerClick) { suppressNextLayerClick = false; return }
      selectLayer(layer.id)
    }
    row.addEventListener('click', selectRowLayer)
    row.addEventListener('keydown', event => {
      if (event.target === row && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault()
        selectRowLayer()
      } else if (event.target === row && event.key === 'Escape') {
        event.preventDefault()
        selectLayer(null)
        canvas.focus()
      }
    })
    list.append(row)
  }
  const hasLayer = !!selected()
  for (const id of ['duplicate-layer', 'delete-layer', 'layer-up', 'layer-down']) {
    ;($<HTMLButtonElement>(id)).disabled = !hasLayer
  }
}
function syncFontPreview() {
  const select = $<HTMLSelectElement>('text-font')
  const menu = $('text-font-menu')
  const formatFamily = (name: string) => `"${name.replace(/["\\]/g, '')}", sans-serif`
  const active = (select.value || '').trim()
  select.style.fontFamily = active ? formatFamily(active) : ''
  select.title = active
  for (const item of Array.from(menu.children) as HTMLElement[]) {
    const selected = item.dataset.family === active
    item.classList.toggle('selected', selected)
    item.setAttribute('aria-selected', String(selected))
  }
}
function setInstalledFonts(fonts: string[]) {
  const select = $<HTMLSelectElement>('text-font')
  select.replaceChildren(...fonts.map(family => {
    const option = new Option(family, family)
    option.style.fontFamily = `"${family.replace(/["\\]/g, '')}", sans-serif`
    return option
  }))
  syncFontPreview()
}
function openFontPreview() {
  const select = $<HTMLSelectElement>('text-font')
  const menu = $('text-font-menu')
  const inspector = document.querySelector('.properties-panel') as HTMLElement
  const control = select.getBoundingClientRect()
  const panel = inspector.getBoundingClientRect()
  const menuHeight = Math.min(220, select.options.length * 36 + 10)
  menu.classList.toggle('above', panel.bottom - control.bottom < menuHeight && control.top - panel.top > panel.bottom - control.bottom)
  menu.replaceChildren()
  for (const option of Array.from(select.options)) {
    const family = (option.value || option.textContent || '').trim()
    if (!family) continue
    const item = document.createElement('button')
    item.type = 'button'
    item.setAttribute('role', 'option')
    item.dataset.family = family
    item.tabIndex = -1
    item.className = 'font-preview-option'
    item.textContent = option.textContent || family
    item.style.fontFamily = option.style.fontFamily
    item.addEventListener('click', () => {
      select.value = family
      menu.hidden = true
      select.focus()
      syncFontPreview()
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    menu.append(item)
  }
  syncFontPreview()
  menu.hidden = false
  const active = Array.from(menu.children).find(item => (item as HTMLElement).dataset.family === select.value) as HTMLElement | undefined
  const focused = active || menu.firstElementChild as HTMLElement | null
  focused?.focus({ preventScroll: true })
  if (focused) menu.scrollTop += focused.getBoundingClientRect().top - menu.getBoundingClientRect().top - 4
}
function refreshInspector() {
  ;($<HTMLInputElement>('title')).value = project.title
  const bg = typeof project.background === 'string' ? null : project.background
  ;($<HTMLSelectElement>('background-type')).value = bg?.type ?? 'solid'
  ;($<HTMLInputElement>('background')).value = bg?.color ?? project.background as string
  ;($<HTMLInputElement>('background-color2')).value = bg?.color2 ?? '#243750'
  ;($<HTMLSelectElement>('background-fit')).value = bg?.fit ?? 'cover'
  $('background-color2-row').hidden = bg?.type !== 'gradient'
  $('background-image-row').hidden = bg?.type !== 'image'
  $('background-image-name').textContent = bg?.imagePath.split(/[\\/]/).pop() || 'No image selected'
  const layer = selected()
  $('no-layer-selected').hidden = !!layer
  $('selected-layer-controls').hidden = !layer
  $('image-options').hidden = layer?.type !== 'image'
  $('text-options').hidden = layer?.type !== 'text'
  $('layer-rotation-row').hidden = layer?.type === 'image' || layer?.type === 'text'
  $('layer-color-row').hidden = layer?.type === 'image'
  if (layer?.type === 'image') {
    ;($<HTMLSelectElement>('image-fit')).value = layer.fit
    ;($<HTMLInputElement>('image-rotation')).value = String(layer.rotation)
    ;($<HTMLInputElement>('image-shadow')).value = String(layer.shadow)
    $('image-name').textContent = layer.imagePath.split(/[\\/]/).pop() || 'No image selected'
  }
  if (layer?.type !== 'text') $('text-font-menu').hidden = true
  if (layer?.type === 'text') {
    for (const [id, value] of [['text-content', layer.text], ['text-font', layer.fontFamily],
      ['text-size', layer.fontSize], ['text-weight', layer.fontWeight], ['text-align', layer.align],
      ['text-rotation', layer.rotation], ['text-shadow', layer.shadow]] as const) {
      ;($<HTMLInputElement | HTMLSelectElement>(id)).value = String(value)
      if (id === 'text-font') syncFontPreview()
    }
  }
  for (const [id, value] of [
    ['layer-name', layer?.name ?? ''], ['layer-x', layer?.x ?? ''], ['layer-y', layer?.y ?? ''],
    ['layer-w', layer?.w ?? ''], ['layer-h', layer?.h ?? ''], ['layer-rotation', layer?.rotation ?? ''],
    ['layer-opacity', layer ? Math.round(layer.opacity * 100) : ''],
    ['layer-color', layer?.color ?? '#55f4e8'],
  ] as const) {
    const input = $<HTMLInputElement>(id)
    input.value = String(value)
    input.disabled = !layer || (layer.locked && ['layer-x', 'layer-y', 'layer-w', 'layer-h', 'layer-rotation'].includes(id))
  }
  const aspectLock = $<HTMLInputElement>('layer-aspect-lock')
  aspectLock.checked = !!layer?.aspectLocked
  aspectLock.disabled = !layer || layer.locked
  for (const [id, value] of [['layer-visible', layer?.visible], ['layer-locked', layer?.locked]] as const) {
    const input = $<HTMLInputElement>(id)
    input.checked = !!value
    input.disabled = !layer
  }
  const spectrum = layer?.type === 'spectrum' ? layer : null
  $('spectrum-options').hidden = !spectrum
  const vectorscope = layer?.type === 'vectorscope' ? layer : null
  $('vectorscope-options').hidden = !vectorscope
  if (vectorscope) {
    for (const [id, value] of [
      ['vectorscope-mode', vectorscope.mode], ['vectorscope-zoom', vectorscope.zoomDb],
      ['vectorscope-low-color', vectorscope.bandLowColor], ['vectorscope-mid-color', vectorscope.bandMidColor],
      ['vectorscope-high-color', vectorscope.bandHighColor],
    ] as const) {
      const input = $<HTMLInputElement | HTMLSelectElement>(id)
      input.value = String(value)
      input.disabled = vectorscope.locked
    }
    for (const [id, value] of [
      ['vectorscope-multiband', vectorscope.multiband], ['vectorscope-grid', vectorscope.showGrid],
      ['vectorscope-correlation', vectorscope.showCorrelation],
    ] as const) {
      const input = $<HTMLInputElement>(id)
      input.checked = value
      input.disabled = vectorscope.locked
    }
  }
  const oscilloscope = layer?.type === 'oscilloscope' ? layer : null
  $('oscilloscope-options').hidden = !oscilloscope
  const spectrogram = layer?.type === 'spectrogram' ? layer : null
  $('spectrogram-options').hidden = !spectrogram
  const waveform = layer?.type === 'waveform' ? layer : null
  $('waveform-options').hidden = !waveform
  if (waveform) {
    for (const [id, value] of [
      ['waveform-mode', waveform.mode], ['waveform-speed', waveform.scrollSpeed],
      ['waveform-low-color', waveform.bandLowColor], ['waveform-mid-color', waveform.bandMidColor],
      ['waveform-high-color', waveform.bandHighColor],
    ] as const) {
      const input = $<HTMLInputElement | HTMLSelectElement>(id)
      input.value = String(value)
      input.disabled = waveform.locked
    }
    ;($<HTMLInputElement>('waveform-multiband')).checked = waveform.multiband
    ;($<HTMLInputElement>('waveform-multiband')).disabled = waveform.locked
  }
  const vu = layer?.type === 'vu' ? layer : null
  $('vu-options').hidden = !vu
  if (vu) {
    for (const [id, value] of [
      ['vu-mode', vu.mode], ['vu-orientation', vu.orientation],
      ['vu-needle-channels', vu.needleChannels], ['vu-reference', vu.referenceDb],
      ['vu-peak-color', vu.peakColor], ['vu-left-color', vu.needleLeftColor],
      ['vu-right-color', vu.needleRightColor], ['vu-combined-color', vu.needleCombinedColor],
    ] as const) {
      const input = $<HTMLInputElement | HTMLSelectElement>(id)
      input.value = String(value)
      input.disabled = vu.locked
    }
    $('vu-orientation-row').hidden = vu.mode !== 'bar'
    $('vu-needle-channels-row').hidden = vu.mode !== 'needle'
  }
  const loudness = layer?.type === 'loudness' ? layer : null
  $('loudness-options').hidden = !loudness
  if (loudness) {
    ;($<HTMLSelectElement>('loudness-readout')).value = loudness.readout
    ;($<HTMLSelectElement>('loudness-readout')).disabled = loudness.locked
    ;($<HTMLInputElement>('loudness-target-color')).value = loudness.targetColor
    ;($<HTMLInputElement>('loudness-target-color')).disabled = loudness.locked
  }
  const waterfall = layer?.type === 'waterfall' ? layer : null
  $('waterfall-options').hidden = !waterfall
  if (waterfall) {
    for (const [id, value] of [
      ['waterfall-fft', waterfall.fftSize], ['waterfall-scale', waterfall.scaleMode],
      ['waterfall-range', waterfall.frequencyRangeMode], ['waterfall-history', waterfall.historySeconds],
      ['waterfall-smoothing', waterfall.smoothing], ['waterfall-density', waterfall.density],
      ['waterfall-color-mode', waterfall.colorMode], ['waterfall-tilt', waterfall.tiltDbPerOctave],
    ] as const) {
      const input = $<HTMLInputElement | HTMLSelectElement>(id)
      input.value = String(value)
      input.disabled = waterfall.locked
    }
    ;($<HTMLInputElement>('waterfall-grid')).checked = waterfall.showGrid
    ;($<HTMLInputElement>('waterfall-grid')).disabled = waterfall.locked
  }
  if (spectrogram) {
    for (const [id, value] of [
      ['spectrogram-fft', spectrogram.fftSize], ['spectrogram-scale', spectrogram.scaleMode],
      ['spectrogram-orientation', spectrogram.orientation], ['spectrogram-color', spectrogram.colorScheme],
      ['spectrogram-clarity', spectrogram.clarityMode], ['spectrogram-min-hz', spectrogram.minFrequency],
      ['spectrogram-max-hz', spectrogram.maxFrequency], ['spectrogram-min-db', spectrogram.minDecibels],
      ['spectrogram-max-db', spectrogram.maxDecibels], ['spectrogram-speed', spectrogram.scrollSpeed],
      ['spectrogram-contrast', spectrogram.contrast], ['spectrogram-tilt', spectrogram.tiltDbPerOctave],
    ] as const) {
      const input = $<HTMLInputElement | HTMLSelectElement>(id)
      input.value = String(value)
      input.disabled = spectrogram.locked
    }
    ;($<HTMLInputElement>('spectrogram-grid')).checked = spectrogram.showGrid
    ;($<HTMLInputElement>('spectrogram-grid')).disabled = spectrogram.locked
  }
  if (oscilloscope) {
    for (const [id, value] of [
      ['oscilloscope-pitch-lock', oscilloscope.pitchLock],
      ['oscilloscope-underfill', oscilloscope.underfillEnabled],
      ['oscilloscope-grid', oscilloscope.showGrid],
    ] as const) {
      const input = $<HTMLInputElement>(id)
      input.checked = value
      input.disabled = oscilloscope.locked
    }
  }
  if (spectrum) {
    for (const [id, value] of [
      ['spectrum-fft', spectrum.fftSize], ['spectrum-scale', spectrum.scaleType],
      ['spectrum-smoothing', spectrum.smoothing], ['spectrum-min-hz', spectrum.minFrequency],
      ['spectrum-max-hz', spectrum.maxFrequency], ['spectrum-min-db', spectrum.minDecibels],
      ['spectrum-max-db', spectrum.maxDecibels],
    ] as const) {
      const input = $<HTMLInputElement | HTMLSelectElement>(id)
      input.value = String(value)
      input.disabled = spectrum.locked
    }
    ;($<HTMLInputElement>('spectrum-side')).checked = spectrum.showSideLine
    ;($<HTMLInputElement>('spectrum-side')).disabled = spectrum.locked
  }
}
function refreshAudio() {
  $('audio-name').textContent = project.audioPath ? project.audioPath.split(/[\\/]/).pop() || project.audioPath : 'No audio imported'
  $('audio-details').textContent = metadata
    ? `${metadata.channels === 1 ? 'Mono' : 'Stereo'} · ${(metadata.sampleRate / 1000).toFixed(1)} kHz · ${metadata.duration.toFixed(2)} s`
    : project.audioPath ? 'Audio missing. Import a replacement file.' : 'Choose a WAV, MP3, or FLAC file'
  const slider = $<HTMLInputElement>('time-slider')
  slider.max = String(Math.max(0, (metadata?.totalFrames ?? 1) - 1))
  frameIndex = Math.min(frameIndex, Number(slider.max))
  updateTimeControls()
}
function renderMissingMedia() {
  const panel = $('missing-media')
  panel.replaceChildren()
  panel.hidden = missingMedia.length === 0
  for (const item of missingMedia) {
    const row = document.createElement('div')
    row.className = 'missing-media-row'
    const description = document.createElement('span')
    description.textContent = `${item.label} is missing: ${item.path}`
    description.title = item.path
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = 'Relink…'
    button.addEventListener('click', async () => {
      try {
        if (item.kind === 'audio') {
          $('import-audio').click()
          return
        }
        const chosen = await window.desktop.chooseImage()
        if (!chosen) return
        if (item.kind === 'background' && typeof project.background !== 'string') project.background.imagePath = chosen
        if (item.kind === 'layer') {
          const layer = project.layers.find(layer => layer.id === item.id)
          if (layer?.type === 'image') layer.imagePath = chosen
        }
        missingMedia = missingMedia.filter(entry => entry !== item)
        renderMissingMedia(); refreshInspector(); await syncAssets()
        setStatus(`Relinked ${item.label}. Save the project to keep the new reference.`)
      } catch (error) { setStatus(String(error)) }
    })
    row.append(description, button)
    panel.append(row)
  }
}
function refreshTemplates(entries: TemplateEntry[], preferred = '') {
  templates = entries
  const list = $<HTMLSelectElement>('template-list')
  const previous = preferred || list.value
  list.replaceChildren(...entries.map(entry => new Option(`${entry.builtIn ? 'Starter · ' : ''}${entry.name}`, entry.id)))
  if (entries.some(entry => entry.id === previous)) list.value = previous
  const active = entries.find(entry => entry.id === list.value)
  ;($<HTMLButtonElement>('rename-template')).disabled = !active || active.builtIn
  if (!$('template-manager-modal').hidden) renderTemplateManager()
}
function resetSongPreview() {
  if (previewTimer) clearTimeout(previewTimer)
  previewRequest++
  void window.desktop.cancelPreview().catch(() => {})
  $('preview-busy').hidden = true
  $('preview-stale').hidden = true
  frameIndex = 0
  analysis = emptyAnalysis()
}
function filenameTitle(input: string) {
  const basename = input.split(/[\\/]/).pop() || input
  return basename.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200) || 'Untitled track'
}
function suggestSongTitle(input: string, previousAudio: string) {
  const suggested = filenameTitle(input)
  const previous = previousAudio ? filenameTitle(previousAudio) : 'Untitled track'
  if (!project.title || project.title === 'Untitled track' || project.title === previous) project.title = suggested
  for (const layer of project.layers) if (layer.type === 'text' && /^song title$/i.test(layer.name)
      && (!layer.text || layer.text === 'Untitled track' || layer.text === previous)) layer.text = suggested
}
function updateTimeControls() {
  project.previewFrame = frameIndex
  ;($<HTMLInputElement>('time-slider')).value = String(frameIndex)
  ;($<HTMLInputElement>('time-input')).value = (frameIndex / 30).toFixed(2)
  updateTitleDirtyIndicator()
}
function repaint() { project = normalizeProject(project) as Project; render(); refreshInspector(); refreshLayers() }
function nextId(prefix = 'scope') {
  let index = 1
  while (project.layers.some(layer => layer.id === `${prefix}-${index}`)) index++
  return `${prefix}-${index}`
}
async function refreshPreview() {
  if (previewTimer) clearTimeout(previewTimer)
  previewTimer = null
  const request = ++previewRequest
  if (!metadata || !project.audioPath) { $('preview-stale').hidden = true; render(); return }
  const requestedFrame = frameIndex
  $('preview-stale').hidden = false
  $('preview-busy').textContent = `Analyzing preview at ${(requestedFrame / 30).toFixed(2)} s…`
  $('preview-busy').hidden = false
  setStatus(`Analyzing audio through ${(requestedFrame / 30).toFixed(2)} s…`)
  try {
    const result = await window.desktop.previewAt(requestedFrame, project)
    if (request !== previewRequest || result.superseded) return
    analysis = decodeAnalysis(result)
    sampleRate = result.sampleRate
    render()
    $('preview-stale').hidden = true
    setStatus(`Real Prism meter still at ${(requestedFrame / 30).toFixed(2)} s.`)
  } catch (error) {
    if (request === previewRequest && !String(error).includes('Preview superseded')) setStatus(String(error))
  } finally {
    if (request === previewRequest) $('preview-busy').hidden = true
  }
}
function markPreviewStale() {
  if (previewTimer) clearTimeout(previewTimer)
  previewRequest++
  void window.desktop.cancelPreview().catch(() => {})
  $('preview-busy').hidden = true
  $('preview-stale').hidden = !metadata || !project.audioPath
  if (metadata && project.audioPath && !exportRunning) {
    setStatus('Audio still is out of date. Press Refresh still to update meter data.')
  }
}
function scheduleTimePreview() {
  if (previewTimer) clearTimeout(previewTimer)
  previewRequest++
  void window.desktop.cancelPreview().catch(() => {})
  $('preview-stale').hidden = false
  $('preview-busy').textContent = `Analyzing preview at ${(frameIndex / 30).toFixed(2)} s…`
  $('preview-busy').hidden = false
  previewTimer = setTimeout(refreshPreview, 180)
}

for (const [id, property] of [['layer-x', 'x'], ['layer-y', 'y'], ['layer-w', 'w'], ['layer-h', 'h']] as const) {
  $<HTMLInputElement>(id).addEventListener('change', event => {
    const layer = selected()
    if (!layer || layer.locked) return
    const value = Math.round(Number((event.target as HTMLInputElement).value))
    if (!Number.isFinite(value)) return refreshInspector()
    const original = { ...layer }
    if (property === 'x') layer.x = Math.max(0, Math.min(project.width - layer.w, value))
    if (property === 'y') layer.y = Math.max(0, Math.min(project.height - layer.h, value))
    const minimum = layer.type === 'text' ? 20 : layer.type === 'image' ? 40 : 80
    if (layer.aspectLocked && (property === 'w' || property === 'h')) {
      const proportional = resizeOnStage(original, property === 'w' ? value - original.w : 0,
        property === 'h' ? value - original.h : 0, minimum, true, false, 0, project.width, project.height)
      layer.w = proportional.w; layer.h = proportional.h
    } else {
      if (property === 'w') layer.w = Math.max(minimum, Math.min(project.width - layer.x, value))
      if (property === 'h') layer.h = Math.max(minimum, Math.min(project.height - layer.y, value))
    }
    repaint()
    if ((layer.type === 'spectrogram' || layer.type === 'waveform' || layer.type === 'waterfall') && (property === 'w' || property === 'h')) markPreviewStale()
  })
}
$<HTMLInputElement>('layer-aspect-lock').addEventListener('change', event => {
  const layer = selected(); if (!layer || layer.locked) return
  layer.aspectLocked = (event.target as HTMLInputElement).checked
  repaint()
})
$<HTMLInputElement>('layer-rotation').addEventListener('change', event => {
  const layer = selected(); if (!layer || layer.locked) return
  const value = Number((event.target as HTMLInputElement).value)
  if (!Number.isFinite(value) || value < -180 || value > 180) return refreshInspector()
  layer.rotation = value
  repaint()
})
$<HTMLInputElement>('title').addEventListener('input', event => { project.title = (event.target as HTMLInputElement).value; render() })
$<HTMLInputElement>('background').addEventListener('input', event => {
  if (project.version === 1) project.background = (event.target as HTMLInputElement).value
  else background().color = (event.target as HTMLInputElement).value
  render()
})
$<HTMLSelectElement>('background-type').addEventListener('change', event => {
  try { upgradeProject(); background().type = (event.target as HTMLSelectElement).value as Background['type']; repaint() }
  catch (error) { refreshInspector(); setStatus(String(error)) }
})
$<HTMLInputElement>('background-color2').addEventListener('input', event => {
  upgradeProject(); background().color2 = (event.target as HTMLInputElement).value; render()
})
$<HTMLSelectElement>('background-fit').addEventListener('change', event => {
  upgradeProject(); background().fit = (event.target as HTMLSelectElement).value as Background['fit']; render()
})
$('background-choose-image').addEventListener('click', async () => {
  try {
    const path = await window.desktop.chooseImage(); if (!path) return
    upgradeProject(); background().imagePath = path; background().type = 'image'
    refreshInspector(); await syncAssets()
  } catch (error) { setStatus(String(error)) }
})
$('image-choose').addEventListener('click', async () => {
  const layer = selected(); if (!layer || layer.type !== 'image' || layer.locked) return
  try {
    const path = await window.desktop.chooseImage(); if (!path) return
    layer.imagePath = path; layer.visible = true; refreshInspector(); refreshLayers(); await syncAssets()
  } catch (error) { setStatus(String(error)) }
})
for (const [id, property] of [['image-fit', 'fit'], ['image-rotation', 'rotation'], ['image-shadow', 'shadow']] as const) {
  $<HTMLInputElement | HTMLSelectElement>(id).addEventListener('change', event => {
    const layer = selected(); if (!layer || layer.type !== 'image' || layer.locked) return
    const previous = { ...layer }
    ;(layer as unknown as Record<string, string | number>)[property] = property === 'fit'
      ? (event.target as HTMLInputElement).value : Number((event.target as HTMLInputElement).value)
    try { repaint() } catch (error) { Object.assign(layer, previous); refreshInspector(); setStatus(String(error)) }
  })
}
for (const [id, property] of [['text-content', 'text'], ['text-font', 'fontFamily'],
  ['text-size', 'fontSize'], ['text-weight', 'fontWeight'], ['text-align', 'align'],
  ['text-rotation', 'rotation'], ['text-shadow', 'shadow']] as const) {
  $<HTMLInputElement | HTMLSelectElement>(id).addEventListener('change', event => {
    const layer = selected(); if (!layer || layer.type !== 'text' || layer.locked) return
    const previous = { ...layer }
    ;(layer as unknown as Record<string, string | number>)[property] = ['fontSize', 'rotation', 'shadow'].includes(property)
      ? Number((event.target as HTMLInputElement).value) : (event.target as HTMLInputElement).value
    try { repaint() } catch (error) { Object.assign(layer, previous); refreshInspector(); setStatus(String(error)) }
  })
}
$<HTMLInputElement>('layer-name').addEventListener('change', event => {
  const layer = selected(); if (!layer) return
  layer.name = (event.target as HTMLInputElement).value.trim() || layer.name
  repaint()
})
$<HTMLInputElement>('layer-opacity').addEventListener('change', event => {
  const layer = selected(); if (!layer) return
  layer.opacity = Math.max(0, Math.min(1, Number((event.target as HTMLInputElement).value) / 100))
  repaint()
})
$<HTMLInputElement>('layer-color').addEventListener('input', event => {
  const layer = selected(); if (!layer) return
  layer.color = (event.target as HTMLInputElement).value
  render()
})
for (const [id, property] of [
  ['vectorscope-mode', 'mode'], ['vectorscope-zoom', 'zoomDb'],
  ['vectorscope-low-color', 'bandLowColor'], ['vectorscope-mid-color', 'bandMidColor'],
  ['vectorscope-high-color', 'bandHighColor'],
] as const) {
  $<HTMLInputElement | HTMLSelectElement>(id).addEventListener('change', event => {
    const layer = selected()
    if (!layer || layer.type !== 'vectorscope' || layer.locked) return
    const previous = { ...layer }
    ;(layer as unknown as Record<string, string | number>)[property] = property === 'zoomDb'
      ? Number((event.target as HTMLInputElement).value) : (event.target as HTMLInputElement).value
    try { project = normalizeProject(project) as Project; render(); refreshInspector() }
    catch (error) { Object.assign(layer, previous); refreshInspector(); setStatus(String(error)) }
  })
}
for (const [id, property] of [
  ['vectorscope-multiband', 'multiband'], ['vectorscope-grid', 'showGrid'],
  ['vectorscope-correlation', 'showCorrelation'],
] as const) {
  $<HTMLInputElement>(id).addEventListener('change', event => {
    const layer = selected()
    if (!layer || layer.type !== 'vectorscope' || layer.locked) return
    layer[property] = (event.target as HTMLInputElement).checked
    render()
    if (property === 'multiband' && layer.multiband && metadata) markPreviewStale()
  })
}
for (const [id, property] of [
  ['spectrum-fft', 'fftSize'], ['spectrum-scale', 'scaleType'],
  ['spectrum-smoothing', 'smoothing'], ['spectrum-min-hz', 'minFrequency'],
  ['spectrum-max-hz', 'maxFrequency'], ['spectrum-min-db', 'minDecibels'],
  ['spectrum-max-db', 'maxDecibels'],
] as const) {
  $<HTMLInputElement | HTMLSelectElement>(id).addEventListener('change', event => {
    const layer = selected()
    if (!layer || layer.type !== 'spectrum' || layer.locked) return
    const previous = { ...layer }
    const value = (event.target as HTMLInputElement).value
    ;(layer as unknown as Record<string, string | number>)[property] = property === 'scaleType' ? value : Number(value)
    try {
      project = normalizeProject(project) as Project
      refreshInspector()
      if (property === 'fftSize' || property === 'smoothing') {
        analysis.spectra = {}
        render(); markPreviewStale()
      } else render()
    } catch (error) {
      Object.assign(layer, previous)
      refreshInspector()
      setStatus(String(error))
    }
  })
}
$<HTMLInputElement>('spectrum-side').addEventListener('change', event => {
  const layer = selected()
  if (!layer || layer.type !== 'spectrum' || layer.locked) return
  layer.showSideLine = (event.target as HTMLInputElement).checked
  render()
})
for (const [id, property] of [
  ['spectrogram-fft', 'fftSize'], ['spectrogram-scale', 'scaleMode'],
  ['spectrogram-orientation', 'orientation'], ['spectrogram-color', 'colorScheme'],
  ['spectrogram-clarity', 'clarityMode'], ['spectrogram-min-hz', 'minFrequency'],
  ['spectrogram-max-hz', 'maxFrequency'], ['spectrogram-min-db', 'minDecibels'],
  ['spectrogram-max-db', 'maxDecibels'], ['spectrogram-speed', 'scrollSpeed'],
  ['spectrogram-contrast', 'contrast'], ['spectrogram-tilt', 'tiltDbPerOctave'],
] as const) {
  $<HTMLInputElement | HTMLSelectElement>(id).addEventListener('change', event => {
    const layer = selected()
    if (!layer || layer.type !== 'spectrogram' || layer.locked) return
    const previous = { ...layer }
    const value = (event.target as HTMLInputElement).value
    ;(layer as unknown as Record<string, string | number>)[property] =
      ['scaleMode', 'orientation', 'colorScheme', 'clarityMode'].includes(property) ? value : Number(value)
    try {
      project = normalizeProject(project) as Project
      analysis.spectrograms = {}
      render(); refreshInspector(); markPreviewStale()
    } catch (error) {
      Object.assign(layer, previous)
      refreshInspector(); setStatus(String(error))
    }
  })
}
$<HTMLInputElement>('spectrogram-grid').addEventListener('change', event => {
  const layer = selected()
  if (!layer || layer.type !== 'spectrogram' || layer.locked) return
  layer.showGrid = (event.target as HTMLInputElement).checked
  render()
})
for (const [id, property] of [
  ['waveform-mode', 'mode'], ['waveform-speed', 'scrollSpeed'],
  ['waveform-low-color', 'bandLowColor'], ['waveform-mid-color', 'bandMidColor'],
  ['waveform-high-color', 'bandHighColor'],
] as const) {
  $<HTMLInputElement | HTMLSelectElement>(id).addEventListener('change', event => {
    const layer = selected()
    if (!layer || layer.type !== 'waveform' || layer.locked) return
    const previous = { ...layer }
    const value = (event.target as HTMLInputElement).value
    ;(layer as unknown as Record<string, string | number>)[property] = property === 'scrollSpeed' ? Number(value) : value
    try {
      project = normalizeProject(project) as Project
      if (property === 'mode' || property === 'scrollSpeed') analysis.waveforms = {}
      render(); refreshInspector()
      if (property === 'mode' || property === 'scrollSpeed') markPreviewStale()
    } catch (error) {
      Object.assign(layer, previous)
      refreshInspector(); setStatus(String(error))
    }
  })
}
$<HTMLInputElement>('waveform-multiband').addEventListener('change', event => {
  const layer = selected()
  if (!layer || layer.type !== 'waveform' || layer.locked) return
  layer.multiband = (event.target as HTMLInputElement).checked
  render()
})
for (const [id, property] of [
  ['vu-mode', 'mode'], ['vu-orientation', 'orientation'],
  ['vu-needle-channels', 'needleChannels'], ['vu-reference', 'referenceDb'],
  ['vu-peak-color', 'peakColor'], ['vu-left-color', 'needleLeftColor'],
  ['vu-right-color', 'needleRightColor'], ['vu-combined-color', 'needleCombinedColor'],
] as const) {
  $<HTMLInputElement | HTMLSelectElement>(id).addEventListener('change', event => {
    const layer = selected()
    if (!layer || layer.type !== 'vu' || layer.locked) return
    const previous = { ...layer }
    const value = (event.target as HTMLInputElement).value
    ;(layer as unknown as Record<string, string | number>)[property] = property === 'referenceDb' ? Number(value) : value
    try {
      project = normalizeProject(project) as Project
      render(); refreshInspector()
    } catch (error) {
      Object.assign(layer, previous)
      refreshInspector(); setStatus(String(error))
    }
  })
}
for (const [id, property] of [['loudness-readout', 'readout'], ['loudness-target-color', 'targetColor']] as const) {
  $<HTMLInputElement | HTMLSelectElement>(id).addEventListener('change', event => {
    const layer = selected()
    if (!layer || layer.type !== 'loudness' || layer.locked) return
    const previous = { ...layer }
    ;(layer as unknown as Record<string, string>)[property] = (event.target as HTMLInputElement).value
    try { project = normalizeProject(project) as Project; render(); refreshInspector() }
    catch (error) { Object.assign(layer, previous); refreshInspector(); setStatus(String(error)) }
  })
}
for (const [id, property] of [
  ['waterfall-fft', 'fftSize'], ['waterfall-scale', 'scaleMode'],
  ['waterfall-range', 'frequencyRangeMode'], ['waterfall-history', 'historySeconds'],
  ['waterfall-smoothing', 'smoothing'], ['waterfall-density', 'density'],
  ['waterfall-color-mode', 'colorMode'], ['waterfall-tilt', 'tiltDbPerOctave'],
] as const) {
  $<HTMLInputElement | HTMLSelectElement>(id).addEventListener('change', event => {
    const layer = selected()
    if (!layer || layer.type !== 'waterfall' || layer.locked) return
    const previous = { ...layer }
    const value = (event.target as HTMLInputElement).value
    ;(layer as unknown as Record<string, string | number>)[property] =
      ['scaleMode', 'frequencyRangeMode', 'density', 'colorMode'].includes(property) ? value : Number(value)
    try {
      project = normalizeProject(project) as Project
      analysis.waterfalls = {}
      render(); refreshInspector(); markPreviewStale()
    } catch (error) { Object.assign(layer, previous); refreshInspector(); setStatus(String(error)) }
  })
}
$<HTMLInputElement>('waterfall-grid').addEventListener('change', event => {
  const layer = selected()
  if (!layer || layer.type !== 'waterfall' || layer.locked) return
  layer.showGrid = (event.target as HTMLInputElement).checked
  analysis.waterfalls = {}
  render(); markPreviewStale()
})
for (const [id, property] of [
  ['oscilloscope-pitch-lock', 'pitchLock'],
  ['oscilloscope-underfill', 'underfillEnabled'],
  ['oscilloscope-grid', 'showGrid'],
] as const) {
  $<HTMLInputElement>(id).addEventListener('change', event => {
    const layer = selected()
    if (!layer || layer.type !== 'oscilloscope' || layer.locked) return
    layer[property] = (event.target as HTMLInputElement).checked
    if (property === 'pitchLock') { analysis.oscilloscopes = {}; render(); markPreviewStale() }
    else render()
  })
}
for (const [id, property] of [['layer-visible', 'visible'], ['layer-locked', 'locked']] as const) {
  $<HTMLInputElement>(id).addEventListener('change', event => {
    const layer = selected(); if (!layer) return
    layer[property] = (event.target as HTMLInputElement).checked
    repaint()
    if (property === 'visible' && (layer.type === 'spectrogram' || layer.type === 'waveform' || layer.type === 'vu' || layer.type === 'loudness' || layer.type === 'waterfall' || (layer.type === 'vectorscope' && layer.multiband)) && layer.visible) markPreviewStale()
  })
}

let drag: { mode: 'move' | 'resize'; x: number; y: number; startX: number; startY: number; startW: number; startH: number } | null = null
function showSnapGuides(x: number | null, y: number | null) {
  const vertical = $<HTMLDivElement>('snap-guide-x')
  const horizontal = $<HTMLDivElement>('snap-guide-y')
  vertical.hidden = x === null
  horizontal.hidden = y === null
  if (x !== null) vertical.style.left = `${x / project.width * 100}%`
  if (y !== null) horizontal.style.top = `${y / project.height * 100}%`
}
$<HTMLInputElement>('snap-enabled').addEventListener('change', () => showSnapGuides(null, null))
selection.addEventListener('pointerdown', event => {
  const layer = selected()
  if (!layer || layer.locked) return
  drag = { mode: (event.target as HTMLElement).dataset.handle === 'resize' ? 'resize' : 'move',
    x: event.clientX, y: event.clientY, startX: layer.x, startY: layer.y, startW: layer.w, startH: layer.h }
  selection.setPointerCapture(event.pointerId)
  event.preventDefault()
})
selection.addEventListener('pointermove', event => {
  const layer = selected()
  if (!drag || !layer) return
  const rect = stageWrap.getBoundingClientRect()
  const dx = Math.round((event.clientX - drag.x) * project.width / rect.width)
  const dy = Math.round((event.clientY - drag.y) * project.height / rect.height)
  const snapping = $<HTMLInputElement>('snap-enabled').checked
  const grid = Number($<HTMLSelectElement>('snap-grid').value)
  const start = { x: drag.startX, y: drag.startY, w: drag.startW, h: drag.startH }
  if (drag.mode === 'move') {
    const moved = moveOnStage(start, dx, dy, snapping, grid, project.width, project.height)
    layer.x = moved.x; layer.y = moved.y
    showSnapGuides(moved.guideX, moved.guideY)
  } else {
    const minimum = layer.type === 'text' ? 20 : layer.type === 'image' ? 40 : 80
    const angle = -layer.rotation * Math.PI / 180
    const localDx = dx * Math.cos(angle) - dy * Math.sin(angle)
    const localDy = dx * Math.sin(angle) + dy * Math.cos(angle)
    const resized = resizeOnStage(start, localDx, localDy, minimum, layer.aspectLocked, snapping, grid, project.width, project.height)
    layer.w = resized.w; layer.h = resized.h
    showSnapGuides(resized.guideX, resized.guideY)
  }
  render(); refreshInspector()
})
function finishDrag() {
  if (drag?.mode === 'resize' && (selected()?.type === 'spectrogram' || selected()?.type === 'waveform' || selected()?.type === 'waterfall')) markPreviewStale()
  drag = null
  showSnapGuides(null, null)
}
selection.addEventListener('pointerup', finishDrag)
selection.addEventListener('lostpointercapture', finishDrag)
canvas.addEventListener('pointerdown', event => {
  if (event.button !== 0 || document.body.classList.contains('stage-fullscreen')) return
  const bounds = canvas.getBoundingClientRect()
  const x = (event.clientX - bounds.left) * project.width / bounds.width
  const y = (event.clientY - bounds.top) * project.height / bounds.height
  const hit = [...project.layers].reverse().find(layer => {
    if (!layer.visible) return false
    const centerX = layer.x + layer.w / 2
    const centerY = layer.y + layer.h / 2
    const angle = layer.rotation * Math.PI / 180
    const localX = (x - centerX) * Math.cos(angle) + (y - centerY) * Math.sin(angle)
    const localY = -(x - centerX) * Math.sin(angle) + (y - centerY) * Math.cos(angle)
    return Math.abs(localX) <= layer.w / 2 && Math.abs(localY) <= layer.h / 2
  })
  selectLayer(hit?.id ?? null)
})
canvas.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !document.body.classList.contains('stage-fullscreen')) {
    event.preventDefault()
    selectLayer(null)
  }
})

function addLayer(type = ($<HTMLSelectElement>('add-type')).value) {
  if (project.layers.length >= 32) return setStatus('The project supports at most 32 layers.')
  if (project.version === 1 && (type === 'image' || type === 'text') && project.layers.length >= 31) {
    return setStatus('Remove a layer before adding graphics to this older project.')
  }
  const id = nextId(type === 'spectrum' ? 'spectrum' : type === 'oscilloscope' ? 'oscilloscope' : type === 'spectrogram' ? 'spectrogram' : type === 'waveform' ? 'waveform' : type === 'vu' ? 'vu' : type === 'loudness' ? 'loudness' : type === 'waterfall' ? 'waterfall' : 'scope')
  if (type === 'spectrum') {
    project.layers.push(spectrumLayer(id, `Spectrum ${project.layers.length + 1}`) as SpectrumLayer)
    if (metadata) markPreviewStale()
  } else if (type === 'oscilloscope') {
    project.layers.push(oscilloscopeLayer(id, `Oscilloscope ${project.layers.length + 1}`) as OscilloscopeLayer)
    if (metadata) markPreviewStale()
  } else if (type === 'spectrogram') {
    project.layers.push(spectrogramLayer(id, `Spectrogram ${project.layers.length + 1}`) as SpectrogramLayer)
    if (metadata) markPreviewStale()
  } else if (type === 'waveform') {
    project.layers.push(waveformLayer(id, `Waveform ${project.layers.length + 1}`) as WaveformLayer)
    if (metadata) markPreviewStale()
  } else if (type === 'vu') {
    project.layers.push(vuLayer(id, `VU meter ${project.layers.length + 1}`) as VuLayer)
    if (metadata) markPreviewStale()
  } else if (type === 'loudness') {
    project.layers.push(loudnessLayer(id, `Loudness ${project.layers.length + 1}`) as LoudnessLayer)
    if (metadata) markPreviewStale()
  } else if (type === 'waterfall') {
    project.layers.push(waterfallLayer(id, `Waterfall ${project.layers.length + 1}`) as WaterfallLayer)
    if (metadata) markPreviewStale()
  } else if (type === 'image') {
    upgradeProject()
    project.layers.push(imageLayer(id, `Artwork ${project.layers.length + 1}`) as ImageLayer)
  } else if (type === 'text') {
    upgradeProject()
    project.layers.push(textLayer(id, `Text ${project.layers.length + 1}`, 'Artist name') as TextLayer)
  } else {
    project.layers.push(vectorscopeLayer(id, `Vectorscope ${project.layers.length + 1}`) as VectorscopeLayer)
    if (metadata) markPreviewStale()
  }
  const added = project.layers.findIndex(layer => layer.id === id)
  if (project.width !== 1280 || project.height !== 720) {
    project.layers[added] = fitLayer(project.layers[added], 1280, 720, project.width, project.height) as Project['layers'][number]
  }
  selectedId = id; repaint()
}
function closeAddLayerMenu(restoreFocus = false) {
  const menu = $('add-layer-menu')
  if (menu.hidden) return
  menu.hidden = true
  $('add-layer').setAttribute('aria-expanded', 'false')
  if (restoreFocus) $('add-layer').focus()
}
function openAddLayerMenu() {
  const select = $<HTMLSelectElement>('add-type')
  const menu = $('add-layer-menu')
  menu.replaceChildren()
  for (const group of Array.from(select.querySelectorAll('optgroup'))) {
    const heading = document.createElement('div')
    heading.className = 'add-layer-group-label'
    heading.setAttribute('role', 'presentation')
    heading.textContent = group.label
    menu.append(heading)
    for (const option of Array.from(group.querySelectorAll('option'))) {
      const type = option.value as Project['layers'][number]['type']
      const item = document.createElement('button')
      item.type = 'button'
      item.className = 'add-layer-option'
      item.setAttribute('role', 'menuitem')
      item.dataset.addType = type
      item.tabIndex = -1
      const icon = document.createElement('span')
      icon.className = 'layer-icon'
      icon.append(layerIconSvg(type))
      const label = document.createElement('span')
      label.className = 'add-layer-option-label'
      label.textContent = option.textContent || type
      item.append(icon, label)
      item.addEventListener('click', () => {
        select.value = type
        closeAddLayerMenu(true)
        addLayer(type)
      })
      menu.append(item)
    }
  }
  menu.hidden = false
  $('add-layer').setAttribute('aria-expanded', 'true')
  const first = menu.querySelector('.add-layer-option') as HTMLButtonElement | null
  first?.focus({ preventScroll: true })
}
$('add-layer').addEventListener('click', event => {
  if (!event.isTrusted) {
    addLayer()
    return
  }
  if ($('add-layer-menu').hidden) openAddLayerMenu()
  else closeAddLayerMenu(true)
})
$('add-layer').addEventListener('keydown', event => {
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    openAddLayerMenu()
  } else if (event.key === 'Escape') {
    closeAddLayerMenu(true)
  }
})
$('add-layer-menu').addEventListener('keydown', event => {
  const items = Array.from($('add-layer-menu').querySelectorAll('.add-layer-option')) as HTMLButtonElement[]
  const index = items.indexOf(document.activeElement as HTMLButtonElement)
  if (event.key === 'Escape') {
    event.preventDefault()
    closeAddLayerMenu(true)
  } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
    event.preventDefault()
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
      : Math.max(0, Math.min(items.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))
    items[next]?.focus({ preventScroll: true })
  }
})
$('add-layer-wrap').addEventListener('focusout', event => {
  const next = (event as FocusEvent).relatedTarget
  if (next && !$('add-layer-wrap').contains(next as Node)) closeAddLayerMenu()
})
$('duplicate-layer').addEventListener('click', () => {
  const layer = selected(); if (!layer) return
  if (project.layers.length >= 32) return setStatus('The project supports at most 32 layers.')
  const copy = { ...layer, id: nextId(), name: `${layer.name} copy`.slice(0, 80), locked: false,
    x: Math.min(layer.x + 20, project.width - layer.w), y: Math.min(layer.y + 20, project.height - layer.h) }
  project.layers.splice(project.layers.indexOf(layer) + 1, 0, copy)
  if ((copy.type === 'spectrum' || copy.type === 'oscilloscope' || copy.type === 'spectrogram' || copy.type === 'waveform' || copy.type === 'vu' || copy.type === 'loudness' || copy.type === 'waterfall' || (copy.type === 'vectorscope' && copy.multiband)) && metadata) markPreviewStale()
  selectedId = copy.id; repaint()
})
$('delete-layer').addEventListener('click', () => {
  const layer = selected(); if (!layer) return
  project.layers.splice(project.layers.indexOf(layer), 1)
  selectedId = project.layers.at(-1)?.id || null; repaint()
})
function moveLayer(direction: number) {
  const layer = selected(); if (!layer) return
  const from = project.layers.indexOf(layer)
  const to = Math.max(0, Math.min(project.layers.length - 1, from + direction))
  if (from === to) return
  project.layers.splice(from, 1); project.layers.splice(to, 0, layer); repaint()
}
$('layer-up').addEventListener('click', () => moveLayer(1))
$('layer-down').addEventListener('click', () => moveLayer(-1))
const layersList = $('layers')
layersList.addEventListener('pointerdown', event => {
  if (event.button !== 0 || (event.target as HTMLElement).closest('.layer-flag')) return
  const row = (event.target as HTMLElement).closest('.layer-item') as HTMLElement | null
  if (!row || !row.dataset.id) return
  layerDrag = { id: row.dataset.id, pointerId: event.pointerId, startY: event.clientY, active: false, targetId: null, position: null }
  try { layersList.setPointerCapture(event.pointerId) } catch {}
  event.preventDefault()
})
layersList.addEventListener('pointermove', event => {
  if (!layerDrag) return
  if (!layerDrag.active) {
    if (Math.abs(event.clientY - layerDrag.startY) < 4 || project.layers.length < 2) return
    layerDrag.active = true
    selectedId = layerDrag.id
    refreshInspector(); updateSelection()
    layersList.classList.add('layers-dragging')
    for (const el of Array.from(layersList.querySelectorAll('.layer-item')) as HTMLElement[]) {
      el.classList.toggle('selected', el.dataset.id === selectedId)
      el.classList.toggle('is-dragging', el.dataset.id === layerDrag.id)
    }
  }
  const rows = Array.from(layersList.querySelectorAll('.layer-item')) as HTMLElement[]
  let bestRow: HTMLElement | null = null
  let bestDist = Infinity
  for (const row of rows) {
    row.classList.remove('drop-before', 'drop-after')
    const rect = row.getBoundingClientRect()
    const midY = rect.top + rect.height / 2
    const dist = Math.abs(event.clientY - midY)
    if (dist < bestDist) {
      bestDist = dist
      bestRow = row
    }
  }
  if (!bestRow || !bestRow.dataset.id || bestRow.dataset.id === layerDrag.id) {
    layerDrag.targetId = null
    layerDrag.position = null
    return
  }
  const rect = bestRow.getBoundingClientRect()
  const position: 'before' | 'after' = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
  layerDrag.targetId = bestRow.dataset.id
  layerDrag.position = position
  bestRow.classList.add(position === 'before' ? 'drop-before' : 'drop-after')
})
function finishLayerDrag() {
  if (!layerDrag) return
  const current = layerDrag
  layerDrag = null
  clearLayerDropClasses()
  if (!current.active) {
    if (selectedId !== current.id) {
      selectedId = current.id
      refreshInspector(); refreshLayers(); updateSelection()
    }
    return
  }
  suppressNextLayerClick = true
  setTimeout(() => { suppressNextLayerClick = false }, 0)
  if (!current.targetId || current.targetId === current.id || !current.position) return
  const visual = [...project.layers].reverse()
  const fromIndex = visual.findIndex(item => item.id === current.id)
  if (fromIndex < 0) return
  const [dragged] = visual.splice(fromIndex, 1)
  const targetIndex = visual.findIndex(item => item.id === current.targetId)
  if (targetIndex < 0) return
  visual.splice(current.position === 'before' ? targetIndex : targetIndex + 1, 0, dragged)
  project.layers = visual.reverse()
  selectedId = current.id
  repaint()
}
layersList.addEventListener('pointerup', finishLayerDrag)
layersList.addEventListener('lostpointercapture', finishLayerDrag)

$<HTMLInputElement>('time-slider').addEventListener('input', event => {
  frameIndex = Number((event.target as HTMLInputElement).value)
  updateTimeControls(); scheduleTimePreview()
})
$<HTMLInputElement>('time-input').addEventListener('change', event => {
  const seconds = Number((event.target as HTMLInputElement).value)
  if (!Number.isFinite(seconds)) { updateTimeControls(); return }
  frameIndex = Math.max(0, Math.min((metadata?.totalFrames ?? 1) - 1, Math.round(seconds * 30)))
  updateTimeControls(); scheduleTimePreview()
})
$('refresh-still').addEventListener('click', refreshPreview)
function setStageFullscreen(active: boolean) {
  document.body.classList.toggle('stage-fullscreen', active)
  $('exit-fullscreen-preview').hidden = !active
  $('fullscreen-preview').setAttribute('aria-pressed', String(active))
  if (active) {
    document.documentElement.requestFullscreen?.().catch(() => {})
    $('exit-fullscreen-preview').focus()
  } else {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {})
    $('fullscreen-preview').focus()
  }
}
$('fullscreen-preview').addEventListener('click', () => {
  setStageFullscreen(!document.body.classList.contains('stage-fullscreen'))
})
$('exit-fullscreen-preview').addEventListener('click', () => setStageFullscreen(false))
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement && document.body.classList.contains('stage-fullscreen')) {
    setStageFullscreen(false)
  }
})
window.addEventListener('keydown', event => {
  if (event.key === 'Escape' && document.body.classList.contains('stage-fullscreen')) {
    event.preventDefault()
    setStageFullscreen(false)
  }
})

$('import-audio').addEventListener('click', async () => {
  try {
    const chosen = await window.desktop.chooseAudio()
    if (!chosen) return
    const previousAudio = project.audioPath
    resetSongPreview()
    project.audioPath = chosen.path; metadata = chosen.metadata
    suggestSongTitle(chosen.path, previousAudio)
    missingMedia = missingMedia.filter(item => item.kind !== 'audio')
    refreshInspector(); refreshAudio(); renderMissingMedia(); await refreshPreview()
  } catch (error) { setStatus(String(error)) }
})
$<HTMLSelectElement>('template-list').addEventListener('change', () => {
  ;($<HTMLButtonElement>('rename-template')).disabled = $<HTMLSelectElement>('template-list').value.startsWith('starter:')
})
function refreshExportResolution() {
  const preset = ($<HTMLSelectElement>('export-preset')).value
  const size = exportDimensions(project, preset)
  const ratio = project.width < project.height ? '9:16' : '16:9'
  $('stage-resolution').textContent = `Layout ${project.width} × ${project.height} · Export ${size.width} × ${size.height} · ${ratio}`
  $('stage-resolution').title = 'Layer coordinates use the saved canvas dimensions; export scales the composition uniformly.'
  ;($<HTMLSelectElement>('export-preset')).options[0].text = `1080p · ${project.width < project.height ? '1080 × 1920' : '1920 × 1080'}`
  ;($<HTMLSelectElement>('export-preset')).options[1].text = `720p · ${project.width} × ${project.height}`
}
$<HTMLSelectElement>('export-preset').addEventListener('change', async event => {
  refreshExportResolution()
  try { await window.desktop.setExportPreset((event.target as HTMLSelectElement).value) }
  catch (error) { setStatus(String(error)) }
})
$<HTMLSelectElement>('audio-mode').addEventListener('change', event => {
  const copy = (event.target as HTMLSelectElement).value === 'copy'
  $('render-mp4').textContent = copy ? 'Render MKV' : 'Render MP4'
})
function closeTemplateConflict(choice: 'replace' | 'rename') {
  if (!resolveTemplateConflict) return
  const finish = resolveTemplateConflict
  resolveTemplateConflict = null
  $('template-conflict-modal').hidden = true
  $('save-template-modal').hidden = false
  $<HTMLInputElement>('template-name').focus()
  finish(choice)
}
function askTemplateConflict(existingName: string): Promise<'replace' | 'rename'> {
  if (resolveTemplateConflict) closeTemplateConflict('rename')
  $('template-conflict-message').textContent = `A layout template named "${existingName}" already exists. Replace it with the current layout or choose a different name?`
  $('template-conflict-modal').hidden = false
  $<HTMLButtonElement>('template-conflict-rename').focus()
  return new Promise(resolve => { resolveTemplateConflict = resolve })
}
$('template-conflict-rename').addEventListener('click', () => closeTemplateConflict('rename'))
$('template-conflict-replace').addEventListener('click', () => closeTemplateConflict('replace'))
$('template-conflict-modal').addEventListener('click', event => {
  if (event.target === $('template-conflict-modal')) closeTemplateConflict('rename')
})
$('template-conflict-modal').addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    closeTemplateConflict('rename')
  } else if (event.key === 'Tab') {
    const renameBtn = $<HTMLButtonElement>('template-conflict-rename')
    const replaceBtn = $<HTMLButtonElement>('template-conflict-replace')
    if (event.shiftKey && document.activeElement === renameBtn) {
      event.preventDefault()
      replaceBtn.focus()
    } else if (!event.shiftKey && document.activeElement === replaceBtn) {
      event.preventDefault()
      renameBtn.focus()
    }
  }
})
function openSaveTemplateModal() {
  const input = $<HTMLInputElement>('template-name')
  input.value = ''
  $('save-template-modal').hidden = false
  input.focus()
}
async function executeSaveTemplate(name: string) {
  const input = $<HTMLInputElement>('template-name')
  if (!name) {
    $('save-template-modal').hidden = false
    input.focus()
    setStatus('Template name must be 1–80 characters')
    return
  }
  templates = await window.desktop.listTemplates()
  const existing = templates.find(entry => entry.name.toLowerCase() === name.toLowerCase())
  if (existing?.builtIn) {
    $('save-template-modal').hidden = false
    input.focus()
    input.select()
    setStatus(`"${existing.name}" is a built-in starter template. Choose a different name.`)
    return
  }
  if (existing) {
    const choice = await askTemplateConflict(existing.name)
    if (choice === 'rename') {
      $('save-template-modal').hidden = false
      input.focus()
      input.select()
      setStatus('Choose a different template name to save a new template.')
      return
    }
    const replaced = await window.desktop.saveTemplate(name, project, existing.id)
    refreshTemplates(await window.desktop.listTemplates(), replaced.id)
    $('save-template-modal').hidden = true
    setStatus(`Replaced layout template: ${replaced.name}`)
    return
  }
  const saved = await window.desktop.saveTemplate(name, project)
  refreshTemplates(await window.desktop.listTemplates(), saved.id)
  $('save-template-modal').hidden = true
  setStatus(`Saved layout template: ${saved.name}`)
}
$('save-template').addEventListener('click', async () => {
  try {
    if (isAutomatedTestSession) {
      const input = $<HTMLInputElement>('template-name')
      await executeSaveTemplate(input.value.trim())
      return
    }
    openSaveTemplateModal()
  } catch (error) { setStatus(String(error)) }
})
$('save-template-confirm').addEventListener('click', async () => {
  try {
    const input = $<HTMLInputElement>('template-name')
    await executeSaveTemplate(input.value.trim())
  } catch (error) { setStatus(String(error)) }
})
$('save-template-cancel').addEventListener('click', () => {
  $('save-template-modal').hidden = true
})
$('save-template-close').addEventListener('click', () => {
  $('save-template-modal').hidden = true
})
$<HTMLInputElement>('template-name').addEventListener('keydown', event => {
  if (event.key === 'Enter') {
    event.preventDefault()
    $('save-template-confirm').click()
  } else if (event.key === 'Escape') {
    event.preventDefault()
    $('save-template-modal').hidden = true
  }
})
function setManagerStatus(message: string) {
  $('template-manager-status').textContent = message
  if (message) setStatus(message)
}
function closeTemplateManager() {
  managerEditingId = null
  managerDeletingId = null
  $('template-manager-modal').hidden = true
  $('open-template-manager').focus()
}
function focusManagerAction(id: string, action: string) {
  const row = Array.from($('template-manager-custom').querySelectorAll<HTMLElement>('.template-manager-row'))
    .find(item => item.dataset.templateId === id)
  row?.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)?.focus()
}
function renderTemplateManager() {
  const builtinsHost = $('template-manager-builtins')
  const customHost = $('template-manager-custom')
  const selectedTemplateId = $<HTMLSelectElement>('template-list').value
  builtinsHost.replaceChildren()
  customHost.replaceChildren()
  for (const entry of templates.filter(item => item.builtIn)) {
    const row = document.createElement('div')
    row.className = `template-manager-row${entry.id === selectedTemplateId ? ' selected' : ''}`
    row.dataset.templateId = entry.id
    row.setAttribute('role', 'listitem')
    const info = document.createElement('div')
    info.className = 'template-manager-info'
    const name = document.createElement('span')
    name.className = 'template-manager-name'
    name.textContent = entry.name
    const badge = document.createElement('span')
    badge.className = 'template-badge template-badge-factory'
    badge.textContent = 'Factory · Read-only'
    info.append(name, badge)
    const actions = document.createElement('div')
    actions.className = 'template-manager-row-actions'
    const useBtn = document.createElement('button')
    useBtn.type = 'button'
    useBtn.dataset.action = 'use'
    useBtn.textContent = 'Use layout'
    useBtn.addEventListener('click', async () => {
      try {
        closeTemplateManager()
        await createProjectFromTemplate(entry.id)
      } catch (error) { setStatus(String(error)) }
    })
    const dupBtn = document.createElement('button')
    dupBtn.type = 'button'
    dupBtn.dataset.action = 'duplicate'
    dupBtn.textContent = 'Duplicate'
    dupBtn.addEventListener('click', async () => {
      try {
        const saved = await window.desktop.duplicateTemplate(entry.id, '')
        $<HTMLInputElement>('template-name').value = saved.name
        managerDeletingId = null
        managerEditingId = saved.id
        refreshTemplates(await window.desktop.listTemplates(), saved.id)
        setManagerStatus(`Duplicated factory template as "${saved.name}".`)
      } catch (error) { setManagerStatus(String(error)) }
    })
    actions.append(useBtn, dupBtn)
    row.append(info, actions)
    builtinsHost.append(row)
  }
  const customEntries = templates.filter(item => !item.builtIn)
  if (customEntries.length === 0) {
    const empty = document.createElement('p')
    empty.className = 'template-manager-empty'
    empty.textContent = 'No custom templates saved yet. Save the current layout or duplicate a factory template above.'
    customHost.append(empty)
    return
  }
  for (const entry of customEntries) {
    const row = document.createElement('div')
    row.className = `template-manager-row${entry.id === selectedTemplateId ? ' selected' : ''}`
    row.dataset.templateId = entry.id
    row.setAttribute('role', 'listitem')
    if (managerEditingId === entry.id) {
      const input = document.createElement('input')
      input.type = 'text'
      input.className = 'template-manager-rename-input'
      input.maxLength = 80
      input.value = entry.name
      input.setAttribute('aria-label', `New name for ${entry.name}`)
      const actions = document.createElement('div')
      actions.className = 'template-manager-row-actions'
      const saveBtn = document.createElement('button')
      saveBtn.type = 'button'
      saveBtn.className = 'primary'
      saveBtn.dataset.action = 'save-rename'
      saveBtn.textContent = 'Save'
      const cancelBtn = document.createElement('button')
      cancelBtn.type = 'button'
      cancelBtn.dataset.action = 'cancel-rename'
      cancelBtn.textContent = 'Cancel'
      const commitRename = async () => {
        const nextName = input.value.trim()
        if (!nextName || nextName.length > 80 || /[\u0000-\u001f]/.test(nextName)) {
          input.focus()
          setManagerStatus('Template name must be 1–80 characters')
          return
        }
        templates = await window.desktop.listTemplates()
        const conflict = templates.find(item => item.id !== entry.id && item.name.toLowerCase() === nextName.toLowerCase())
        if (conflict?.builtIn) {
          input.focus()
          input.select()
          setManagerStatus(`"${conflict.name}" is a built-in starter template. Choose a different name.`)
          return
        }
        if (conflict) {
          input.focus()
          input.select()
          setManagerStatus(`Template "${conflict.name}" already exists. Choose a different name.`)
          return
        }
        try {
          const renamed = await window.desktop.renameTemplate(entry.id, nextName)
          managerEditingId = null
          $<HTMLInputElement>('template-name').value = renamed.name
          refreshTemplates(await window.desktop.listTemplates(), renamed.id)
          focusManagerAction(renamed.id, 'rename')
          setManagerStatus(`Renamed layout template: ${renamed.name}`)
        } catch (error) { setManagerStatus(String(error)) }
      }
      saveBtn.addEventListener('click', () => { void commitRename() })
      cancelBtn.addEventListener('click', () => {
        managerEditingId = null
        renderTemplateManager()
        focusManagerAction(entry.id, 'rename')
      })
      input.addEventListener('keydown', event => {
        if (event.key === 'Enter') {
          event.preventDefault()
          void commitRename()
        } else if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          managerEditingId = null
          renderTemplateManager()
          focusManagerAction(entry.id, 'rename')
        }
      })
      actions.append(saveBtn, cancelBtn)
      row.append(input, actions)
      customHost.append(row)
      queueMicrotask(() => { input.focus(); input.select() })
    } else if (managerDeletingId === entry.id) {
      const prompt = document.createElement('span')
      prompt.className = 'template-manager-confirm-text'
      prompt.textContent = `Delete "${entry.name}"?`
      const actions = document.createElement('div')
      actions.className = 'template-manager-row-actions'
      const confirmBtn = document.createElement('button')
      confirmBtn.type = 'button'
      confirmBtn.className = 'danger-button'
      confirmBtn.dataset.action = 'confirm-delete'
      confirmBtn.textContent = 'Delete'
      const cancelBtn = document.createElement('button')
      cancelBtn.type = 'button'
      cancelBtn.dataset.action = 'cancel-delete'
      cancelBtn.textContent = 'Cancel'
      confirmBtn.addEventListener('click', async () => {
        try {
          const removed = await window.desktop.deleteTemplate(entry.id)
          managerDeletingId = null
          const nameInput = $<HTMLInputElement>('template-name')
          if (nameInput.value.trim().toLowerCase() === removed.name.toLowerCase()) nameInput.value = ''
          refreshTemplates(await window.desktop.listTemplates())
          $<HTMLButtonElement>('template-manager-close').focus()
          setManagerStatus(`Deleted layout template: ${removed.name}`)
        } catch (error) { setManagerStatus(String(error)) }
      })
      cancelBtn.addEventListener('click', () => {
        managerDeletingId = null
        renderTemplateManager()
        focusManagerAction(entry.id, 'delete')
      })
      actions.append(confirmBtn, cancelBtn)
      row.append(prompt, actions)
      customHost.append(row)
    } else {
      const info = document.createElement('div')
      info.className = 'template-manager-info'
      const name = document.createElement('span')
      name.className = 'template-manager-name'
      name.textContent = entry.name
      const badge = document.createElement('span')
      badge.className = 'template-badge'
      badge.textContent = 'Custom'
      info.append(name, badge)
      const actions = document.createElement('div')
      actions.className = 'template-manager-row-actions'
      const useBtn = document.createElement('button')
      useBtn.type = 'button'
      useBtn.dataset.action = 'use'
      useBtn.textContent = 'Use layout'
      useBtn.addEventListener('click', async () => {
        try {
          closeTemplateManager()
          await createProjectFromTemplate(entry.id)
        } catch (error) { setStatus(String(error)) }
      })
      const dupBtn = document.createElement('button')
      dupBtn.type = 'button'
      dupBtn.dataset.action = 'duplicate'
      dupBtn.textContent = 'Duplicate'
      dupBtn.addEventListener('click', async () => {
        try {
          const saved = await window.desktop.duplicateTemplate(entry.id, '')
          $<HTMLInputElement>('template-name').value = saved.name
          managerDeletingId = null
          managerEditingId = null
          refreshTemplates(await window.desktop.listTemplates(), saved.id)
          focusManagerAction(saved.id, 'duplicate')
          setManagerStatus(`Duplicated layout template: ${saved.name}`)
        } catch (error) { setManagerStatus(String(error)) }
      })
      const renameBtn = document.createElement('button')
      renameBtn.type = 'button'
      renameBtn.dataset.action = 'rename'
      renameBtn.textContent = 'Rename'
      renameBtn.addEventListener('click', () => {
        managerDeletingId = null
        managerEditingId = entry.id
        renderTemplateManager()
      })
      const deleteBtn = document.createElement('button')
      deleteBtn.type = 'button'
      deleteBtn.className = 'danger-button'
      deleteBtn.dataset.action = 'delete'
      deleteBtn.textContent = 'Delete'
      deleteBtn.addEventListener('click', () => {
        managerEditingId = null
        managerDeletingId = entry.id
        renderTemplateManager()
      })
      actions.append(useBtn, dupBtn, renameBtn, deleteBtn)
      row.append(info, actions)
      customHost.append(row)
    }
  }
}
$('open-template-manager').addEventListener('click', async () => {
  try {
    managerEditingId = null
    managerDeletingId = null
    $('template-manager-status').textContent = ''
    templates = await window.desktop.listTemplates()
    refreshTemplates(templates)
    $('template-manager-modal').hidden = false
    renderTemplateManager()
    $('template-manager-close').focus()
  } catch (error) { setStatus(String(error)) }
})
$('template-manager-close').addEventListener('click', () => closeTemplateManager())
$('template-manager-modal').addEventListener('click', event => {
  if (event.target === $('template-manager-modal')) closeTemplateManager()
})
$('template-manager-modal').addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    if (managerEditingId || managerDeletingId) {
      const id = managerEditingId || managerDeletingId || ''
      const action = managerEditingId ? 'rename' : 'delete'
      managerEditingId = null
      managerDeletingId = null
      renderTemplateManager()
      focusManagerAction(id, action)
    } else {
      closeTemplateManager()
    }
  } else if (event.key === 'Tab') {
    const modal = $('template-manager-modal')
    const focusable = Array.from(modal.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button:not([disabled]), input:not([disabled])'))
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    } else if (!modal.contains(document.activeElement)) {
      event.preventDefault()
      first.focus()
    }
  }
})
$('load-template').addEventListener('click', async () => {
  try {
    const id = $<HTMLSelectElement>('template-list').value
    const loaded = await window.desktop.loadTemplate(id, project)
    const activeTemplate = templates.find(entry => entry.id === id)
    if (activeTemplate && !activeTemplate.builtIn) $<HTMLInputElement>('template-name').value = activeTemplate.name
    resetSongPreview()
    project = normalizeProject(loaded.project) as Project
    missingMedia = loaded.missingMedia
    selectedId = project.layers.at(-1)?.id || null
    refreshInspector(); refreshLayers(); refreshAudio(); renderMissingMedia(); await syncAssets()
    if (metadata) await refreshPreview()
    else setStatus('Layout loaded. Import audio to preview and export.')
  } catch (error) { setStatus(String(error)) }
})
$('duplicate-template').addEventListener('click', async () => {
  try {
    const id = $<HTMLSelectElement>('template-list').value
    const name = $<HTMLInputElement>('template-name').value.trim()
    templates = await window.desktop.listTemplates()
    const hasConflict = !!name && templates.some(entry => entry.name.toLowerCase() === name.toLowerCase())
    const saved = await window.desktop.duplicateTemplate(id, !name || hasConflict ? '' : name)
    $<HTMLInputElement>('template-name').value = saved.name
    refreshTemplates(await window.desktop.listTemplates(), saved.id)
    setStatus(`Duplicated layout template: ${saved.name}`)
  } catch (error) { setStatus(String(error)) }
})
$('rename-template').addEventListener('click', async () => {
  try {
    const id = $<HTMLSelectElement>('template-list').value
    const name = $<HTMLInputElement>('template-name').value.trim()
    if (id.startsWith('starter:')) {
      setStatus('Duplicate a starter template before renaming it.')
      return
    }
    const input = $<HTMLInputElement>('template-name')
    if (!name || name.length > 80 || /[\u0000-\u001f]/.test(name)) {
      input.focus()
      setStatus('Template name must be 1–80 characters')
      return
    }
    templates = await window.desktop.listTemplates()
    const conflict = templates.find(entry => entry.id !== id && entry.name.toLowerCase() === name.toLowerCase())
    if (conflict?.builtIn) {
      input.focus()
      input.select()
      setStatus(`"${conflict.name}" is a built-in starter template. Choose a different name.`)
      return
    }
    if (conflict) {
      input.focus()
      input.select()
      setStatus(`Template "${conflict.name}" already exists. Choose a different name.`)
      return
    }
    const renamed = await window.desktop.renameTemplate(id, name)
    refreshTemplates(await window.desktop.listTemplates(), renamed.id)
    setStatus(`Renamed layout template: ${renamed.name}`)
  } catch (error) { setStatus(String(error)) }
})
$('save-project').addEventListener('click', async () => {
  try {
    const saved = await window.desktop.saveProject(project)
    if (saved) {
      projectPath = saved.path; project = normalizeProject(saved.project) as Project
      missingMedia = saved.missingMedia
      markProjectSaved()
      refreshInspector(); renderMissingMedia(); await syncAssets()
      setStatus(`Saved project: ${saved.path}`)
    }
  } catch (error) { setStatus(String(error)) }
})
$('save-project-as').addEventListener('click', async () => {
  try {
    const saved = await window.desktop.saveProject(project, true)
    if (saved) {
      projectPath = saved.path; project = normalizeProject(saved.project) as Project
      missingMedia = saved.missingMedia
      markProjectSaved()
      refreshInspector(); renderMissingMedia(); await syncAssets()
      setStatus(`Saved new project: ${saved.path}`)
    }
  } catch (error) { setStatus(String(error)) }
})
async function applyLoadedProject(loaded: Initial) {
  project = normalizeProject(loaded.project) as Project
  setInstalledFonts(loaded.fonts)
  metadata = loaded.metadata; projectPath = loaded.projectPath
  selectedId = project.layers.at(-1)?.id || null; resetSongPreview()
  frameIndex = project.previewFrame ?? 0
  missingMedia = loaded.missingMedia
  refreshInspector(); refreshLayers(); refreshAudio(); markProjectSaved(); renderMissingMedia(); await syncAssets()
  showEditor()
  if (metadata) await refreshPreview()
  else setStatus(project.audioPath ? 'Project opened.' : 'Ready. Import audio to preview still.')
}

function showProjectManager() {
  const managerStatus = $('project-manager-status')
  managerStatus.textContent = ''
  managerStatus.hidden = true
  $<HTMLDivElement>('project-manager-screen').hidden = false
  $<HTMLDivElement>('editor-screen').hidden = true
  updateTitleDirtyIndicator()
}

function showEditor() {
  $<HTMLDivElement>('project-manager-screen').hidden = true
  $<HTMLDivElement>('editor-screen').hidden = false
  render()
}

async function createProjectFromTemplate(id: string) {
  const loaded = await window.desktop.newProjectFromTemplate(id)
  await applyLoadedProject(loaded)
}

async function openRecent(targetPath: string) {
  try {
    const loaded = await window.desktop.openProjectPath(targetPath)
    if (!loaded) return
    await applyLoadedProject(loaded)
  } catch (error) { setStatus(String(error)) }
}

function renderRecentProjects(list: RecentProject[]) {
  const grid = $('recent-projects-grid')
  const empty = $('recent-projects-empty')
  const count = $('recent-projects-count')
  grid.innerHTML = ''
  count.textContent = `${list.length} project${list.length === 1 ? '' : 's'}`
  if (!list.length) {
    grid.hidden = true
    empty.hidden = false
    return
  }
  grid.hidden = false
  empty.hidden = true
  for (const item of list) {
    const card = document.createElement('div')
    card.className = 'project-card'
    card.setAttribute('role', 'listitem')
    card.setAttribute('tabindex', '0')

    const thumb = document.createElement('div')
    thumb.className = 'project-card-thumb'
    thumb.innerHTML = '<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 16V8M12 16V11M17 16V13"/></svg>'

    const info = document.createElement('div')
    info.className = 'project-card-info'

    const title = document.createElement('div')
    title.className = 'project-card-title'
    title.textContent = item.name

    const pathDiv = document.createElement('div')
    pathDiv.className = 'project-card-path'
    pathDiv.textContent = item.path
    pathDiv.title = item.path

    const timeDiv = document.createElement('div')
    timeDiv.className = 'project-card-time'
    const date = new Date(item.lastOpened)
    timeDiv.textContent = Number.isFinite(date.getTime())
      ? `Opened ${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
      : 'Recently opened'

    info.appendChild(title)
    info.appendChild(pathDiv)
    info.appendChild(timeDiv)

    card.appendChild(thumb)
    card.appendChild(info)

    card.addEventListener('click', () => openRecent(item.path))
    card.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        openRecent(item.path)
      }
    })
    grid.appendChild(card)
  }
}

async function refreshRecentProjects() {
  try {
    const list = await window.desktop.getRecentProjects()
    renderRecentProjects(list)
  } catch (error) { setStatus(String(error)) }
}

function openTemplatePicker() {
  const select = $<HTMLSelectElement>('template-picker-select')
  select.innerHTML = ''
  for (const tmpl of templates) {
    const option = document.createElement('option')
    option.value = tmpl.id
    option.textContent = tmpl.name + (tmpl.builtIn ? ' (Starter)' : ' (Custom)')
    select.appendChild(option)
  }
  $<HTMLDivElement>('template-picker-modal').hidden = false
  select.focus()
}

function closeTemplatePicker() {
  $<HTMLDivElement>('template-picker-modal').hidden = true
  $('pm-new-template').focus()
}

$('open-project').addEventListener('click', () => {
  confirmDiscardIfDirty(async () => {
    try {
      const loaded = await window.desktop.openProject()
      if (!loaded) return
      await applyLoadedProject(loaded)
    } catch (error) { setStatus(String(error)) }
  })
})
async function closeCurrentProject() {
  const result = await window.desktop.closeProject()
  project = normalizeProject(result.project) as Project
  projectPath = null
  metadata = null
  missingMedia = []
  selectedId = null
  markProjectSaved()
  refreshInspector()
  refreshLayers()
  refreshAudio()
  renderMissingMedia()
  await syncAssets()
  resetSongPreview()
  await refreshRecentProjects()
  showProjectManager()
  setStatus('Project closed.')
}
$('close-project').addEventListener('click', () => {
  confirmDiscardIfDirty(async () => {
    try {
      await closeCurrentProject()
    } catch (error) { setStatus(String(error)) }
  })
})
$('unsaved-changes-cancel').addEventListener('click', () => {
  closeUnsavedChangesModal()
})
$('unsaved-changes-discard').addEventListener('click', async () => {
  const action = pendingUnsavedAction
  closeUnsavedChangesModal()
  if (action) await action()
})
$('unsaved-changes-save').addEventListener('click', async () => {
  const action = pendingUnsavedAction
  closeUnsavedChangesModal()
  try {
    const result = await window.desktop.saveProject(project, false)
    if (result) {
      projectPath = result.path
      project = normalizeProject(result.project) as Project
      missingMedia = result.missingMedia
      markProjectSaved()
      refreshInspector()
      renderMissingMedia()
      await syncAssets()
      setStatus(`Saved project: ${result.path}`)
      if (action) await action()
    }
  } catch (error) {
    setStatus(`Save failed: ${String(error)}`)
  }
})
window.desktop.onAppCloseRequested(() => {
  if ($('editor-screen').hidden || !isProjectDirty()) {
    window.desktop.confirmAppClose()
    return
  }
  confirmDiscardIfDirty(() => {
    window.desktop.confirmAppClose()
  })
})
$('pm-open-project').addEventListener('click', async () => {
  try {
    const loaded = await window.desktop.openProject()
    if (!loaded) return
    await applyLoadedProject(loaded)
  } catch (error) { setStatus(String(error)) }
})
$('pm-new-blank').addEventListener('click', async () => {
  try {
    const loaded = await window.desktop.newBlankProject()
    await applyLoadedProject(loaded)
  } catch (error) { setStatus(String(error)) }
})
$('pm-new-template').addEventListener('click', () => openTemplatePicker())
$('template-picker-close').addEventListener('click', () => closeTemplatePicker())
$('template-picker-cancel').addEventListener('click', () => closeTemplatePicker())
$('template-picker-create').addEventListener('click', async () => {
  const select = $<HTMLSelectElement>('template-picker-select')
  const tmplId = select.value
  if (!tmplId) return
  closeTemplatePicker()
  try {
    await createProjectFromTemplate(tmplId)
  } catch (error) { setStatus(String(error)) }
})

$('render-mp4').addEventListener('click', async () => {
  if (exportRunning) return
  if (!metadata || !project.audioPath) return setStatus('Import audio before rendering.')
  try {
    refreshExportResolution()
    const output = await window.desktop.renderVideo(project, ($<HTMLSelectElement>('export-preset')).value,
      ($<HTMLSelectElement>('audio-mode')).value)
    if (!output) return
    exportRunning = true
    ;($<HTMLButtonElement>('render-mp4')).disabled = true
    ;($<HTMLSelectElement>('audio-mode')).disabled = true
    $('cancel-render').hidden = false
    setStatus(`Rendering to ${output}`)
  } catch (error) { setStatus(String(error)) }
})
$('cancel-render').addEventListener('click', async () => {
  await window.desktop.cancelRender()
  setStatus('Cancellation requested…')
})
window.desktop.onExport(event => {
  if (event.event === 'analysis-progress') {
    setStatus(`Analyzing spectrum ${event.configuration}/${event.configurations}: ${event.frames}/${event.total} frames.`)
  }
  if (event.event === 'oscilloscope-progress') {
    setStatus(`Analyzing oscilloscope: ${event.frames}/${event.total} frames.`)
  }
  if (event.event === 'spectrogram-progress') {
    setStatus(`Analyzing spectrogram ${event.configuration}/${event.configurations}: ${event.frames}/${event.total} frames.`)
  }
  if (event.event === 'waveform-progress') {
    setStatus(`Analyzing waveform ${event.configuration}/${event.configurations}: ${event.frames}/${event.total} frames.`)
  }
  if (event.event === 'vu-progress') {
    setStatus(`Analyzing VU: ${event.frames}/${event.total} frames.`)
  }
  if (event.event === 'loudness-progress') {
    setStatus(`Analyzing loudness: ${event.frames}/${event.total} frames.`)
  }
  if (event.event === 'waterfall-progress') {
    setStatus(`Analyzing waterfall ${event.configuration}/${event.configurations}: ${event.frames}/${event.total} frames.`)
  }
  if (event.event === 'progress') {
    const value = 100 * Number(event.frames) / Number(event.totalFrames);
    ;($('progress-bar') as HTMLElement).style.width = `${value.toFixed(1)}%`
    setStatus(`Rendering ${event.frames}/${event.totalFrames} frames (${value.toFixed(1)}%).`)
  }
  if (event.event === 'finished' || event.event === 'failed' || event.event === 'cancelled') {
    exportRunning = false;
    ;($<HTMLButtonElement>('render-mp4')).disabled = false
    ;($<HTMLSelectElement>('audio-mode')).disabled = false
    $('cancel-render').hidden = true
    const container = String(event.output).toLowerCase().endsWith('.mkv') ? 'MKV' : 'MP4'
    setStatus(event.event === 'finished' ? `${container} ready: ${event.output}`
      : event.event === 'cancelled' ? 'Export cancelled. No video was saved.'
      : `Export failed: ${event.message || ''}`)
  }
})

$<HTMLSelectElement>('text-font').addEventListener('mousedown', event => {
  if (selected()?.locked) return
  event.preventDefault()
  const menu = $('text-font-menu')
  if (menu.hidden) openFontPreview()
  else { menu.hidden = true; $<HTMLSelectElement>('text-font').focus() }
})
$<HTMLSelectElement>('text-font').addEventListener('keydown', event => {
  if (selected()?.locked) return
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    openFontPreview()
  } else if (event.key === 'Escape') {
    $('text-font-menu').hidden = true
  }
})
$('text-font-menu').addEventListener('keydown', event => {
  const menu = $('text-font-menu')
  const items = Array.from(menu.children) as HTMLButtonElement[]
  const index = items.indexOf(document.activeElement as HTMLButtonElement)
  if (event.key === 'Escape') {
    event.preventDefault()
    menu.hidden = true
    $<HTMLSelectElement>('text-font').focus()
  } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
    event.preventDefault()
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
      : Math.max(0, Math.min(items.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))
    const item = items[next]
    item?.focus({ preventScroll: true })
    if (item) {
      const bounds = item.getBoundingClientRect()
      const viewport = menu.getBoundingClientRect()
      if (bounds.top < viewport.top + 4) menu.scrollTop -= viewport.top + 4 - bounds.top
      else if (bounds.bottom > viewport.bottom - 4) menu.scrollTop += bounds.bottom - viewport.bottom + 4
    }
  }
})
$('text-font-wrap').addEventListener('focusout', event => {
  const next = (event as FocusEvent).relatedTarget
  if (next && !$('text-font-wrap').contains(next as Node)) $('text-font-menu').hidden = true
})
document.addEventListener('pointerdown', event => {
  const menu = $('text-font-menu')
  if (!menu.hidden && !$('text-font-wrap').contains(event.target as Node)) {
    menu.hidden = true
  }
  if (!$('add-layer-menu').hidden && !$('add-layer-wrap').contains(event.target as Node)) {
    closeAddLayerMenu()
  }
})
async function start() {
  const initial = await window.desktop.initial()
  isAutomatedTestSession = Boolean(initial.isAutomatedTest)
  project = normalizeProject(initial.project) as Project
  setInstalledFonts(initial.fonts)
  metadata = initial.metadata; projectPath = initial.projectPath
  missingMedia = initial.missingMedia
  selectedId = project.layers.at(-1)?.id || null
  frameIndex = project.previewFrame ?? 0
  templates = initial.templates
  refreshTemplates(initial.templates, initial.preferences.lastTemplateId)
  ;($<HTMLSelectElement>('export-preset')).value = initial.preferences.exportPreset
  refreshExportResolution()
  refreshInspector(); refreshLayers(); refreshAudio(); markProjectSaved(); renderMissingMedia(); await syncAssets()

  const recentList = initial.preferences.recentProjects || []
  renderRecentProjects(recentList)

  if (initial.isStartupSession) {
    showProjectManager()
    setTimeout(() => {
      const splash = $('splash-screen')
      if (splash) {
        splash.style.opacity = '0'
        setTimeout(() => { splash.hidden = true }, 350)
      }
    }, 650)
  } else {
    const splash = $('splash-screen')
    if (splash) splash.hidden = true
    showEditor()
    if (metadata) await refreshPreview()
  }
}
start().catch(error => setStatus(String(error)))

$<HTMLSelectElement>('canvas-orientation').addEventListener('change', event => {
  try {
    upgradeProject()
    project = orientProject(project, (event.target as HTMLSelectElement).value) as Project
    analysis = emptyAnalysis()
    showSnapGuides(null, null)
    markPreviewStale()
    repaint()
    setStatus('Canvas orientation changed. Layout fitted without cropping; adjust layers as needed and refresh the still.')
  } catch (error) { setStatus(String(error)); render() }
})
function updateWindowState(state: { fullscreen: boolean; maximized: boolean }) {
  document.body.classList.toggle('window-fullscreen', state.fullscreen)
  document.body.classList.toggle('window-restorable', state.maximized || state.fullscreen)
  const button = $('window-maximize')
  const label = state.fullscreen ? 'Exit fullscreen' : state.maximized ? 'Restore' : 'Maximize'
  button.setAttribute('aria-label', label)
  button.title = label
}
window.desktop.onWindowState(updateWindowState)
void window.desktop.windowState().then(updateWindowState).catch(error => setStatus(String(error)))
for (const [id, action] of [['window-minimize', window.desktop.minimizeWindow],
  ['window-maximize', window.desktop.maximizeWindow], ['window-close', window.desktop.closeWindow]] as const) {
  $(id).addEventListener('click', () => { void action().catch(error => setStatus(String(error))) })
}
window.addEventListener('keydown', event => {
  if (event.key === 'F11') {
    event.preventDefault()
    void window.desktop.toggleWindowFullscreen().catch(error => setStatus(String(error)))
  } else if (event.key === 'Escape' && document.body.classList.contains('window-fullscreen')) {
    void window.desktop.toggleWindowFullscreen().catch(error => setStatus(String(error)))
  }
})

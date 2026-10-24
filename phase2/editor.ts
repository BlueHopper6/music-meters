import { Composition, decodeAnalysis, type AnalysisFrame, type Project, type SpectrumLayer,
  type OscilloscopeLayer } from './composition'
import { defaultProject, spectrumLayer, oscilloscopeLayer, normalizeProject } from './project.cjs'

type Metadata = { channels: number; sampleRate: number; duration: number; totalFrames: number }
type Initial = { project: Project; metadata: Metadata | null; projectPath: string | null }
type Desktop = {
  initial(): Promise<Initial>
  chooseAudio(): Promise<{ path: string; metadata: Metadata } | null>
  previewAt(frame: number, project: Project): Promise<
    { x: string; y: string; spectra: Record<string, { mid: string; side: string }>;
      oscilloscopes: Record<string, { samples: string; detectedPitch: number; triggerIndex: number }>;
      sampleRate: number; frameIndex: number; superseded?: false }
    | { superseded: true }>
  saveProject(project: Project): Promise<string | null>
  openProject(): Promise<Initial | null>
  renderMp4(project: Project, preset: string): Promise<string | null>
  cancelRender(): Promise<void>
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
const emptyAnalysis = (): AnalysisFrame => ({ vectorscope: { x: new Float32Array(0), y: new Float32Array(0) },
  spectra: {}, oscilloscopes: {} })
let analysis = emptyAnalysis()
let sampleRate = 48000
let frameIndex = 0
let selectedId: string | null = project.layers[0]?.id || null
let previewRequest = 0
let previewTimer: ReturnType<typeof setTimeout> | null = null
let exportRunning = false
let projectPath: string | null = null

function selected() { return project.layers.find(layer => layer.id === selectedId) }
function setStatus(message: string) { status.textContent = message }
function render() {
  composition.render(project, analysis, frameIndex, sampleRate)
  updateSelection()
}
function updateSelection() {
  const layer = selected()
  selection.hidden = !layer || !layer.visible
  if (!layer) return
  selection.style.left = `${layer.x / 1280 * 100}%`
  selection.style.top = `${layer.y / 720 * 100}%`
  selection.style.width = `${layer.w / 1280 * 100}%`
  selection.style.height = `${layer.h / 720 * 100}%`
  selection.classList.toggle('locked', layer.locked)
  selection.querySelector('.selection-label')!.textContent = layer.name
}
function refreshLayers() {
  const list = $('layers')
  list.replaceChildren()
  for (const layer of [...project.layers].reverse()) {
    const button = document.createElement('button')
    button.className = `layer-item${layer.id === selectedId ? ' selected' : ''}`
    button.type = 'button'
    button.dataset.id = layer.id
    const icon = document.createElement('span')
    icon.className = 'layer-icon'
    icon.textContent = '◉'
    const name = document.createElement('span')
    name.className = 'layer-name'
    name.textContent = layer.name
    const flags = document.createElement('span')
    flags.className = 'layer-flags'
    flags.textContent = `${layer.visible ? '' : '◌'}${layer.locked ? ' 🔒' : ''}`
    button.append(icon, name, flags)
    button.addEventListener('click', () => { selectedId = layer.id; refreshInspector(); refreshLayers(); updateSelection() })
    list.append(button)
  }
  const hasLayer = !!selected()
  for (const id of ['duplicate-layer', 'delete-layer', 'layer-up', 'layer-down']) {
    ;($<HTMLButtonElement>(id)).disabled = !hasLayer
  }
}
function refreshInspector() {
  ;($<HTMLInputElement>('title')).value = project.title
  ;($<HTMLInputElement>('background')).value = project.background
  const layer = selected()
  for (const [id, value] of [
    ['layer-name', layer?.name ?? ''], ['layer-x', layer?.x ?? ''], ['layer-y', layer?.y ?? ''],
    ['layer-w', layer?.w ?? ''], ['layer-h', layer?.h ?? ''],
    ['layer-opacity', layer ? Math.round(layer.opacity * 100) : ''],
    ['layer-color', layer?.color ?? '#55f4e8'],
  ] as const) {
    const input = $<HTMLInputElement>(id)
    input.value = String(value)
    input.disabled = !layer || (layer.locked && ['layer-x', 'layer-y', 'layer-w', 'layer-h'].includes(id))
  }
  for (const [id, value] of [['layer-visible', layer?.visible], ['layer-locked', layer?.locked]] as const) {
    const input = $<HTMLInputElement>(id)
    input.checked = !!value
    input.disabled = !layer
  }
  const spectrum = layer?.type === 'spectrum' ? layer : null
  $('spectrum-options').hidden = !spectrum
  const oscilloscope = layer?.type === 'oscilloscope' ? layer : null
  $('oscilloscope-options').hidden = !oscilloscope
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
function updateTimeControls() {
  ;($<HTMLInputElement>('time-slider')).value = String(frameIndex)
  ;($<HTMLInputElement>('time-input')).value = (frameIndex / 30).toFixed(2)
}
function repaint() { project = normalizeProject(project) as Project; render(); refreshInspector(); refreshLayers() }
function nextId(prefix = 'scope') {
  let index = 1
  while (project.layers.some(layer => layer.id === `${prefix}-${index}`)) index++
  return `${prefix}-${index}`
}
async function refreshPreview() {
  const request = ++previewRequest
  if (!metadata || !project.audioPath) { render(); return }
  $('preview-busy').hidden = false
  setStatus(`Analyzing audio through ${(frameIndex / 30).toFixed(2)} s…`)
  try {
    const result = await window.desktop.previewAt(frameIndex, project)
    if (request !== previewRequest || result.superseded) return
    analysis = decodeAnalysis(result)
    sampleRate = result.sampleRate
    render()
    setStatus(`Real Prism meter still at ${(frameIndex / 30).toFixed(2)} s.`)
  } catch (error) {
    if (request === previewRequest && !String(error).includes('Preview superseded')) setStatus(String(error))
  } finally {
    if (request === previewRequest) $('preview-busy').hidden = true
  }
}
function schedulePreview() {
  if (previewTimer) clearTimeout(previewTimer)
  previewRequest++
  $('preview-busy').hidden = false
  previewTimer = setTimeout(refreshPreview, 180)
}

for (const [id, property] of [['layer-x', 'x'], ['layer-y', 'y'], ['layer-w', 'w'], ['layer-h', 'h']] as const) {
  $<HTMLInputElement>(id).addEventListener('change', event => {
    const layer = selected()
    if (!layer || layer.locked) return
    const value = Math.round(Number((event.target as HTMLInputElement).value))
    if (!Number.isFinite(value)) return refreshInspector()
    if (property === 'x') layer.x = Math.max(0, Math.min(1280 - layer.w, value))
    if (property === 'y') layer.y = Math.max(0, Math.min(720 - layer.h, value))
    if (property === 'w') layer.w = Math.max(80, Math.min(1280 - layer.x, value))
    if (property === 'h') layer.h = Math.max(80, Math.min(720 - layer.y, value))
    repaint()
  })
}
$<HTMLInputElement>('title').addEventListener('input', event => { project.title = (event.target as HTMLInputElement).value; render() })
$<HTMLInputElement>('background').addEventListener('input', event => { project.background = (event.target as HTMLInputElement).value; render() })
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
        render(); schedulePreview()
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
  ['oscilloscope-pitch-lock', 'pitchLock'],
  ['oscilloscope-underfill', 'underfillEnabled'],
  ['oscilloscope-grid', 'showGrid'],
] as const) {
  $<HTMLInputElement>(id).addEventListener('change', event => {
    const layer = selected()
    if (!layer || layer.type !== 'oscilloscope' || layer.locked) return
    layer[property] = (event.target as HTMLInputElement).checked
    if (property === 'pitchLock') { analysis.oscilloscopes = {}; render(); schedulePreview() }
    else render()
  })
}
for (const [id, property] of [['layer-visible', 'visible'], ['layer-locked', 'locked']] as const) {
  $<HTMLInputElement>(id).addEventListener('change', event => {
    const layer = selected(); if (!layer) return
    layer[property] = (event.target as HTMLInputElement).checked
    repaint()
  })
}

let drag: { mode: 'move' | 'resize'; x: number; y: number; startX: number; startY: number; startW: number; startH: number } | null = null
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
  const dx = Math.round((event.clientX - drag.x) * 1280 / rect.width)
  const dy = Math.round((event.clientY - drag.y) * 720 / rect.height)
  if (drag.mode === 'move') {
    layer.x = Math.max(0, Math.min(1280 - layer.w, drag.startX + dx))
    layer.y = Math.max(0, Math.min(720 - layer.h, drag.startY + dy))
  } else {
    layer.w = Math.max(80, Math.min(1280 - layer.x, drag.startW + dx))
    layer.h = Math.max(80, Math.min(720 - layer.y, drag.startH + dy))
  }
  render(); refreshInspector()
})
selection.addEventListener('pointerup', () => { drag = null })
selection.addEventListener('lostpointercapture', () => { drag = null })

$('add-layer').addEventListener('click', () => {
  if (project.layers.length >= 32) return setStatus('The project supports at most 32 layers.')
  const type = ($<HTMLSelectElement>('add-type')).value
  const id = nextId(type === 'spectrum' ? 'spectrum' : type === 'oscilloscope' ? 'oscilloscope' : 'scope')
  if (type === 'spectrum') {
    project.layers.push(spectrumLayer(id, `Spectrum ${project.layers.length + 1}`) as SpectrumLayer)
    if (metadata) schedulePreview()
  } else if (type === 'oscilloscope') {
    project.layers.push(oscilloscopeLayer(id, `Oscilloscope ${project.layers.length + 1}`) as OscilloscopeLayer)
    if (metadata) schedulePreview()
  } else {
    project.layers.push({ id, type: 'vectorscope', name: `Vectorscope ${project.layers.length + 1}`,
      x: 390, y: 170, w: 500, h: 500, visible: true, locked: false, opacity: 1, color: '#55f4e8' })
  }
  selectedId = id; repaint()
})
$('duplicate-layer').addEventListener('click', () => {
  const layer = selected(); if (!layer) return
  if (project.layers.length >= 32) return setStatus('The project supports at most 32 layers.')
  const copy = { ...layer, id: nextId(), name: `${layer.name} copy`.slice(0, 80), locked: false,
    x: Math.min(layer.x + 20, 1280 - layer.w), y: Math.min(layer.y + 20, 720 - layer.h) }
  project.layers.splice(project.layers.indexOf(layer) + 1, 0, copy)
  if ((copy.type === 'spectrum' || copy.type === 'oscilloscope') && metadata) schedulePreview()
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

$<HTMLInputElement>('time-slider').addEventListener('input', event => {
  frameIndex = Number((event.target as HTMLInputElement).value)
  updateTimeControls(); schedulePreview()
})
$<HTMLInputElement>('time-input').addEventListener('change', event => {
  const seconds = Number((event.target as HTMLInputElement).value)
  if (!Number.isFinite(seconds)) { updateTimeControls(); return }
  frameIndex = Math.max(0, Math.min((metadata?.totalFrames ?? 1) - 1, Math.round(seconds * 30)))
  updateTimeControls(); schedulePreview()
})
$('refresh-still').addEventListener('click', refreshPreview)

$('import-audio').addEventListener('click', async () => {
  try {
    const chosen = await window.desktop.chooseAudio()
    if (!chosen) return
    project.audioPath = chosen.path; metadata = chosen.metadata; frameIndex = 0
    analysis = emptyAnalysis()
    refreshAudio(); await refreshPreview()
  } catch (error) { setStatus(String(error)) }
})
$('save-project').addEventListener('click', async () => {
  try {
    const path = await window.desktop.saveProject(project)
    if (path) { projectPath = path; setStatus(`Saved project: ${path}`) }
  } catch (error) { setStatus(String(error)) }
})
$('open-project').addEventListener('click', async () => {
  try {
    const loaded = await window.desktop.openProject()
    if (!loaded) return
    project = normalizeProject(loaded.project) as Project
    metadata = loaded.metadata; projectPath = loaded.projectPath
    selectedId = project.layers.at(-1)?.id || null; frameIndex = 0
    analysis = emptyAnalysis()
    refreshInspector(); refreshLayers(); refreshAudio(); render()
    if (metadata) await refreshPreview()
    else setStatus('Project opened. Audio is missing; import a replacement file.')
  } catch (error) { setStatus(String(error)) }
})
$('render-mp4').addEventListener('click', async () => {
  if (exportRunning) return
  if (!metadata || !project.audioPath) return setStatus('Import audio before rendering.')
  try {
    const output = await window.desktop.renderMp4(project, ($<HTMLSelectElement>('export-preset')).value)
    if (!output) return
    exportRunning = true
    ;($<HTMLButtonElement>('render-mp4')).disabled = true
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
  if (event.event === 'progress') {
    const value = 100 * Number(event.frames) / Number(event.totalFrames);
    ;($('progress-bar') as HTMLElement).style.width = `${value.toFixed(1)}%`
    setStatus(`Rendering ${event.frames}/${event.totalFrames} frames (${value.toFixed(1)}%).`)
  }
  if (event.event === 'finished' || event.event === 'failed' || event.event === 'cancelled') {
    exportRunning = false;
    ;($<HTMLButtonElement>('render-mp4')).disabled = false
    $('cancel-render').hidden = true
    setStatus(event.event === 'finished' ? `MP4 ready: ${event.output}` : `Export ${event.event}: ${event.message || ''}`)
  }
})

async function start() {
  const initial = await window.desktop.initial()
  project = normalizeProject(initial.project) as Project
  metadata = initial.metadata; projectPath = initial.projectPath
  selectedId = project.layers.at(-1)?.id || null
  refreshInspector(); refreshLayers(); refreshAudio(); render()
  if (metadata) await refreshPreview()
}
start().catch(error => setStatus(String(error)))

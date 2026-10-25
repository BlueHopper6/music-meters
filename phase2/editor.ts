import { Composition, decodeAnalysis, type AnalysisFrame, type Project, type VectorscopeLayer, type SpectrumLayer,
  type OscilloscopeLayer, type SpectrogramLayer, type WaveformLayer, type VuLayer, type LoudnessLayer, type WaterfallLayer,
  type ImageLayer, type TextLayer, type Background } from './composition'
import { defaultProject, vectorscopeLayer, spectrumLayer, oscilloscopeLayer, spectrogramLayer, waveformLayer, vuLayer, loudnessLayer, waterfallLayer, imageLayer, textLayer, normalizeProject } from './project.cjs'

type Metadata = { channels: number; sampleRate: number; duration: number; totalFrames: number }
type Initial = { project: Project; metadata: Metadata | null; projectPath: string | null; fonts: string[] }
type Desktop = {
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

function selected() { return project.layers.find(layer => layer.id === selectedId) }
function setStatus(message: string) { status.textContent = message }
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
function render() {
  composition.render(project, analysis, frameIndex, sampleRate)
  updateSelection()
}
function updateSelection() {
  const layer = selected()
  const minimum = layer?.type === 'text' ? 20 : layer?.type === 'image' ? 40 : 80
  ;($<HTMLInputElement>('layer-w')).min = String(minimum)
  ;($<HTMLInputElement>('layer-h')).min = String(minimum)
  selection.hidden = !layer || !layer.visible
  if (!layer) return
  selection.style.left = `${layer.x / 1280 * 100}%`
  selection.style.top = `${layer.y / 720 * 100}%`
  selection.style.width = `${layer.w / 1280 * 100}%`
  selection.style.height = `${layer.h / 720 * 100}%`
  selection.style.transform = layer.type === 'image' || layer.type === 'text' ? `rotate(${layer.rotation}deg)` : ''
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
    icon.append(layerIconSvg(layer.type))
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
  $('image-options').hidden = layer?.type !== 'image'
  $('text-options').hidden = layer?.type !== 'text'
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
    const minimum = layer.type === 'text' ? 20 : layer.type === 'image' ? 40 : 80
    if (property === 'w') layer.w = Math.max(minimum, Math.min(1280 - layer.x, value))
    if (property === 'h') layer.h = Math.max(minimum, Math.min(720 - layer.y, value))
    repaint()
    if ((layer.type === 'spectrogram' || layer.type === 'waveform' || layer.type === 'waterfall') && (property === 'w' || property === 'h')) schedulePreview()
  })
}
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
    layer.imagePath = path; refreshInspector(); await syncAssets()
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
    if (property === 'multiband' && layer.multiband && metadata) schedulePreview()
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
      render(); refreshInspector(); schedulePreview()
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
      if (property === 'mode' || property === 'scrollSpeed') schedulePreview()
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
      render(); refreshInspector(); schedulePreview()
    } catch (error) { Object.assign(layer, previous); refreshInspector(); setStatus(String(error)) }
  })
}
$<HTMLInputElement>('waterfall-grid').addEventListener('change', event => {
  const layer = selected()
  if (!layer || layer.type !== 'waterfall' || layer.locked) return
  layer.showGrid = (event.target as HTMLInputElement).checked
  analysis.waterfalls = {}
  render(); schedulePreview()
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
    if (property === 'visible' && (layer.type === 'spectrogram' || layer.type === 'waveform' || layer.type === 'vu' || layer.type === 'loudness' || layer.type === 'waterfall' || (layer.type === 'vectorscope' && layer.multiband)) && layer.visible) schedulePreview()
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
    const minimum = layer.type === 'text' ? 20 : layer.type === 'image' ? 40 : 80
    layer.w = Math.max(minimum, Math.min(1280 - layer.x, drag.startW + dx))
    layer.h = Math.max(minimum, Math.min(720 - layer.y, drag.startH + dy))
  }
  render(); refreshInspector()
})
function finishDrag() {
  if (drag?.mode === 'resize' && (selected()?.type === 'spectrogram' || selected()?.type === 'waveform' || selected()?.type === 'waterfall')) schedulePreview()
  drag = null
}
selection.addEventListener('pointerup', finishDrag)
selection.addEventListener('lostpointercapture', finishDrag)

$('add-layer').addEventListener('click', () => {
  if (project.layers.length >= 32) return setStatus('The project supports at most 32 layers.')
  const type = ($<HTMLSelectElement>('add-type')).value
  if (project.version === 1 && (type === 'image' || type === 'text') && project.layers.length >= 31) {
    return setStatus('Remove a layer before adding graphics to this older project.')
  }
  const id = nextId(type === 'spectrum' ? 'spectrum' : type === 'oscilloscope' ? 'oscilloscope' : type === 'spectrogram' ? 'spectrogram' : type === 'waveform' ? 'waveform' : type === 'vu' ? 'vu' : type === 'loudness' ? 'loudness' : type === 'waterfall' ? 'waterfall' : 'scope')
  if (type === 'spectrum') {
    project.layers.push(spectrumLayer(id, `Spectrum ${project.layers.length + 1}`) as SpectrumLayer)
    if (metadata) schedulePreview()
  } else if (type === 'oscilloscope') {
    project.layers.push(oscilloscopeLayer(id, `Oscilloscope ${project.layers.length + 1}`) as OscilloscopeLayer)
    if (metadata) schedulePreview()
  } else if (type === 'spectrogram') {
    project.layers.push(spectrogramLayer(id, `Spectrogram ${project.layers.length + 1}`) as SpectrogramLayer)
    if (metadata) schedulePreview()
  } else if (type === 'waveform') {
    project.layers.push(waveformLayer(id, `Waveform ${project.layers.length + 1}`) as WaveformLayer)
    if (metadata) schedulePreview()
  } else if (type === 'vu') {
    project.layers.push(vuLayer(id, `VU meter ${project.layers.length + 1}`) as VuLayer)
    if (metadata) schedulePreview()
  } else if (type === 'loudness') {
    project.layers.push(loudnessLayer(id, `Loudness ${project.layers.length + 1}`) as LoudnessLayer)
    if (metadata) schedulePreview()
  } else if (type === 'waterfall') {
    project.layers.push(waterfallLayer(id, `Waterfall ${project.layers.length + 1}`) as WaterfallLayer)
    if (metadata) schedulePreview()
  } else if (type === 'image') {
    upgradeProject()
    project.layers.push(imageLayer(id, `Artwork ${project.layers.length + 1}`) as ImageLayer)
  } else if (type === 'text') {
    upgradeProject()
    project.layers.push(textLayer(id, `Text ${project.layers.length + 1}`, 'Artist name') as TextLayer)
  } else {
    project.layers.push(vectorscopeLayer(id, `Vectorscope ${project.layers.length + 1}`) as VectorscopeLayer)
  }
  selectedId = id; repaint()
})
$('duplicate-layer').addEventListener('click', () => {
  const layer = selected(); if (!layer) return
  if (project.layers.length >= 32) return setStatus('The project supports at most 32 layers.')
  const copy = { ...layer, id: nextId(), name: `${layer.name} copy`.slice(0, 80), locked: false,
    x: Math.min(layer.x + 20, 1280 - layer.w), y: Math.min(layer.y + 20, 720 - layer.h) }
  project.layers.splice(project.layers.indexOf(layer) + 1, 0, copy)
  if ((copy.type === 'spectrum' || copy.type === 'oscilloscope' || copy.type === 'spectrogram' || copy.type === 'waveform' || copy.type === 'vu' || copy.type === 'loudness' || copy.type === 'waterfall' || (copy.type === 'vectorscope' && copy.multiband)) && metadata) schedulePreview()
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
    setInstalledFonts(loaded.fonts)
    metadata = loaded.metadata; projectPath = loaded.projectPath
    selectedId = project.layers.at(-1)?.id || null; frameIndex = 0
    analysis = emptyAnalysis()
    refreshInspector(); refreshLayers(); refreshAudio(); await syncAssets()
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
    $('cancel-render').hidden = true
    setStatus(event.event === 'finished' ? `MP4 ready: ${event.output}` : `Export ${event.event}: ${event.message || ''}`)
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
})
async function start() {
  const initial = await window.desktop.initial()
  project = normalizeProject(initial.project) as Project
  setInstalledFonts(initial.fonts)
  metadata = initial.metadata; projectPath = initial.projectPath
  selectedId = project.layers.at(-1)?.id || null
  refreshInspector(); refreshLayers(); refreshAudio(); await syncAssets()
  if (metadata) await refreshPreview()
}
start().catch(error => setStatus(String(error)))

import { Vectorscope, type VectorscopeMode } from '../upstream/prism/src/renderer/visualizers/Vectorscope'
import { SpectrumAnalyzer } from '../upstream/prism/src/renderer/visualizers/SpectrumAnalyzer'
import { Oscilloscope } from '../upstream/prism/src/renderer/visualizers/Oscilloscope'
import { Spectrogram } from '../upstream/prism/src/renderer/visualizers/Spectrogram'
import { Waveform } from '../upstream/prism/src/renderer/visualizers/Waveform'
import { VUMeter } from '../upstream/prism/src/renderer/visualizers/VUMeter'
import { LUFSMeter } from '../upstream/prism/src/renderer/visualizers/LUFSMeter'
import { Waterfall } from '../upstream/prism/src/renderer/visualizers/Waterfall'
import type { WaterfallFrame, WaterfallNativeAnalyzer } from '../upstream/prism/src/types/waterfall'
import type { SpectrumNativeAnalyzer, OscilloscopeNativeAnalyzer, SpectrogramNativeAnalyzer, WaveformNativeAnalyzer, VUMeterNativeAnalyzer, LUFSMeterNativeAnalyzer } from '../upstream/prism/src/renderer/audio/native'
import type { SpectrogramNativeOptions, SpectrogramNativeResult, VUMeterNativeSnapshot, LUFSMeterNativeSnapshot } from '../upstream/prism/src/renderer/audio/native/visualizer-dsp'
import { normalizeProject } from './project.cjs'
import { vectorscopeCorrelations } from '../phase3/vectorscope-correlation.cjs'

type BaseLayer = {
  id: string; name: string; x: number; y: number; w: number; h: number
  visible: boolean; locked: boolean; aspectLocked: boolean; rotation: number; opacity: number; color: string
}
export type VectorscopeLayer = BaseLayer & { type: 'vectorscope'; mode: VectorscopeMode;
  zoomDb: number; multiband: boolean; showGrid: boolean; showCorrelation: boolean;
  bandLowColor: string; bandMidColor: string; bandHighColor: string }
export type SpectrumLayer = BaseLayer & {
  type: 'spectrum'; fftSize: number; smoothing: number; scaleType: 'log' | 'mel' | 'linear'
  minFrequency: number; maxFrequency: number; minDecibels: number; maxDecibels: number
  showSideLine: boolean
}
export type OscilloscopeLayer = BaseLayer & {
  type: 'oscilloscope'; pitchLock: boolean; underfillEnabled: boolean; showGrid: boolean
}
export type SpectrogramLayer = BaseLayer & {
  type: 'spectrogram'; fftSize: number; scaleMode: 'log' | 'mel' | 'linear'
  orientation: 'horizontal' | 'vertical'; minFrequency: number; maxFrequency: number
  minDecibels: number; maxDecibels: number; scrollSpeed: number; contrast: number
  tiltDbPerOctave: number; clarityMode: 'classic' | 'focused' | 'sharp' | 'sharper'
  colorScheme: 'heat' | 'mono'; showGrid: boolean
}
export type WaveformLayer = BaseLayer & { type: 'waveform'; mode: 'mono' | 'stereo'
  scrollSpeed: number; multiband: boolean; bandLowColor: string; bandMidColor: string; bandHighColor: string }
export type VuLayer = BaseLayer & { type: 'vu'; mode: 'bar' | 'needle'; orientation: 'horizontal' | 'vertical'
  needleChannels: 'stereo' | 'combined'; referenceDb: number; peakColor: string
  needleLeftColor: string; needleRightColor: string; needleCombinedColor: string }
export type LoudnessLayer = BaseLayer & { type: 'loudness'; readout: 'momentary' | 'shortTerm' | 'integrated'; targetColor: string }
export type WaterfallLayer = BaseLayer & { type: 'waterfall'; fftSize: number; scaleMode: 'log' | 'mel' | 'linear'
  frequencyRangeMode: 'extended' | 'audible'; historySeconds: number; density: 'sparse' | 'balanced' | 'dense'
  colorMode: 'theme' | 'heat'; smoothing: number; tiltDbPerOctave: number; showGrid: boolean }
export type ImageLayer = BaseLayer & { type: 'image'; imagePath: string; fit: 'cover' | 'contain'; rotation: number; shadow: number }
export type TextLayer = BaseLayer & { type: 'text'; text: string; fontFamily: string; fontSize: number;
  fontWeight: 'normal' | 'bold'; align: 'left' | 'center' | 'right'; rotation: number; shadow: number }
export type Layer = VectorscopeLayer | SpectrumLayer | OscilloscopeLayer | SpectrogramLayer | WaveformLayer | VuLayer | LoudnessLayer | WaterfallLayer | ImageLayer | TextLayer
type MeterLayer = Exclude<Layer, ImageLayer | TextLayer>
export type Background = { type: 'solid' | 'gradient' | 'image'; color: string; color2: string; imagePath: string; fit: 'cover' | 'contain' }
export type Project = {
  version: number; width: number; height: number; fps: number; title: string
  background: string | Background; audioPath: string; layers: Layer[]
}
export type Points = { x: Float32Array; y: Float32Array }
export type VectorscopeFrame = Points & { multiband: Float32Array }
export type SpectrumBins = { mid: Float32Array; side: Float32Array }
export type OscilloscopeWave = { samples: Float32Array; detectedPitch: number; triggerIndex: number }
export type SpectrogramColumns = SpectrogramNativeResult
export type SpectrogramFrame = { rebuild: boolean; entries: SpectrogramColumns[] }
export type WaveformFrame = { rebuild: boolean; entries: Float32Array[] }
export type VuFrame = { rebuild: boolean; startFrame: number; values: Float32Array }
export type AnalysisFrame = { vectorscope: VectorscopeFrame; spectra: Record<string, SpectrumBins>;
  oscilloscopes: Record<string, OscilloscopeWave>; spectrograms: Record<string, SpectrogramFrame>;
  waveforms: Record<string, WaveformFrame>; vus: Record<string, VuFrame>;
  loudness: Record<string, Float32Array>; waterfalls: Record<string, WaterfallFrame> }

export function decodeFloats(encoded: string): Float32Array {
  const binary = atob(encoded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Float32Array(bytes.buffer)
}

export function decodeAnalysis(encoded: { x: string; y: string; multiband?: string;
  spectra?: Record<string, { mid: string; side: string }>;
  oscilloscopes?: Record<string, { samples: string; detectedPitch: number; triggerIndex: number }>;
  spectrograms?: Record<string, { rebuild: boolean; entries: Array<{
    columnCount: number; rowCount: number; display: string; heat: string }> }>;
  waveforms?: Record<string, { rebuild: boolean; entries: Array<{ columns: number; summary: string }> }>;
  vus?: Record<string, { rebuild: boolean; startFrame: number; values: string }>;
  loudness?: Record<string, string>;
  waterfalls?: Record<string, { columns: number; audioSeconds: number; levels: string; ages: string; frequencies: string }> }): AnalysisFrame {
  const spectra: Record<string, SpectrumBins> = {}
  for (const [key, value] of Object.entries(encoded.spectra || {})) {
    spectra[key] = { mid: decodeFloats(value.mid), side: decodeFloats(value.side) }
  }
  const oscilloscopes: Record<string, OscilloscopeWave> = {}
  for (const [key, value] of Object.entries(encoded.oscilloscopes || {})) {
    oscilloscopes[key] = { samples: decodeFloats(value.samples),
      detectedPitch: value.detectedPitch, triggerIndex: value.triggerIndex }
  }
  const spectrograms: Record<string, SpectrogramFrame> = {}
  for (const [key, value] of Object.entries(encoded.spectrograms || {})) {
    spectrograms[key] = { rebuild: value.rebuild, entries: value.entries.map(entry => ({
      columnCount: entry.columnCount, rowCount: entry.rowCount,
      display: decodeFloats(entry.display), heat: decodeFloats(entry.heat) })) }
  }
  const waveforms: Record<string, WaveformFrame> = {}
  for (const [key, value] of Object.entries(encoded.waveforms || {})) {
    waveforms[key] = { rebuild: value.rebuild, entries: value.entries.map(entry => decodeFloats(entry.summary)) }
  }
  const vus: Record<string, VuFrame> = {}
  for (const [key, value] of Object.entries(encoded.vus || {})) {
    vus[key] = { rebuild: value.rebuild, startFrame: value.startFrame, values: decodeFloats(value.values) }
  }
  const loudness: Record<string, Float32Array> = {}
  for (const [key, value] of Object.entries(encoded.loudness || {})) loudness[key] = decodeFloats(value)
  const waterfalls: Record<string, WaterfallFrame> = {}
  for (const [key, value] of Object.entries(encoded.waterfalls || {})) {
    waterfalls[key] = { columns: value.columns, audioSeconds: value.audioSeconds,
      levels: decodeFloats(value.levels), ages: decodeFloats(value.ages), frequencies: decodeFloats(value.frequencies) }
  }
  return { vectorscope: { x: decodeFloats(encoded.x), y: decodeFloats(encoded.y),
    multiband: decodeFloats(encoded.multiband || '') }, spectra, oscilloscopes, spectrograms, waveforms, vus, loudness, waterfalls }
}

function drawCorrelationOverlay(canvas: HTMLCanvasElement, layer: VectorscopeLayer, frame: VectorscopeFrame): void {
  const ctx = canvas.getContext('2d')!
  const values = vectorscopeCorrelations(frame.x, frame.y, layer.multiband ? frame.multiband : null)
  const rows: Array<{ label: string; value: number; color: string }> = [
    { label: 'CORR', value: values.overall, color: layer.color },
  ]
  if (layer.multiband && values.bands) {
    for (const [index, label, color] of [
      [0, 'LOW', layer.bandLowColor], [1, 'MID', layer.bandMidColor],
      [2, 'HIGH', layer.bandHighColor],
    ] as const) rows.push({ label, value: values.bands[index], color })
  }
  const panelWidth = Math.min(layer.w - 8, 230)
  const rowHeight = 17
  const panelHeight = rows.length * rowHeight + 10
  const left = 4, top = layer.h - panelHeight - 4
  const barX = left + 52, barWidth = Math.max(18, panelWidth - 95)
  ctx.save()
  ctx.setTransform(canvas.width / layer.w, 0, 0, canvas.height / layer.h, 0, 0)
  ctx.fillStyle = 'rgba(8, 18, 34, 0.88)'
  ctx.fillRect(left, top, panelWidth, panelHeight)
  ctx.font = '10px Arial'
  ctx.textBaseline = 'middle'
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index], y = top + 13 + index * rowHeight
    ctx.fillStyle = '#dbeafe'
    ctx.textAlign = 'left'
    ctx.fillText(row.label, left + 7, y)
    ctx.fillStyle = 'rgba(205, 220, 240, 0.22)'
    ctx.fillRect(barX, y - 3, barWidth, 6)
    ctx.fillStyle = 'rgba(231, 241, 255, 0.7)'
    ctx.fillRect(barX + barWidth / 2, y - 5, 1, 10)
    ctx.fillStyle = row.value < 0 ? '#ffb45c' : row.color
    const half = barWidth / 2
    ctx.fillRect(barX + half + (row.value < 0 ? row.value * half : 0), y - 3,
      Math.max(1, Math.abs(row.value) * half), 6)
    ctx.fillStyle = '#e7f1ff'
    ctx.textAlign = 'right'
    ctx.fillText(`${row.value >= 0 ? '+' : ''}${row.value.toFixed(2)}`, left + panelWidth - 6, y)
  }
  ctx.restore()
}

class SpectrumSnapshot implements SpectrumNativeAnalyzer {
  bins: SpectrumBins = { mid: new Float32Array(0), side: new Float32Array(0) }
  isAvailable() { return true }
  hasSpectrumData() { return this.bins.mid.length > 0 }
  setFFTSize(_size: number) {}
  getFFTSize() { return this.bins.mid.length * 2 }
  setSampleRate(_sampleRate: number) {}
  setSmoothing(_smoothing: number) {}
  pushSamples(_audioData: Float32Array) {}
  pushStereoSamples(_left: Float32Array, _right: Float32Array) {}
  fillRawMagnitudes(_output: Float32Array) { return 0 }
  fillMagnitudes(output: Float32Array) { return this.copy(this.bins.mid, output) }
  fillSideMagnitudes(output: Float32Array) { return this.copy(this.bins.side, output) }
  fillChannelMaxMagnitudes(_output: Float32Array) { return 0 }
  getRawMagnitudes() { return null }
  getMagnitudes() { return this.bins.mid }
  getSideMagnitudes() { return this.bins.side }
  getChannelMaxMagnitudes() { return null }
  process(_audioData: Float32Array) { return this.bins.mid }
  binToFrequency(_bin: number) { return 0 }
  reset() {}
  private copy(source: Float32Array, output: Float32Array) {
    const count = Math.min(source.length, output.length)
    output.set(source.subarray(0, count))
    return count
  }
}

class OscilloscopeSnapshot implements OscilloscopeNativeAnalyzer {
  wave: OscilloscopeWave = { samples: new Float32Array(0), detectedPitch: 0, triggerIndex: 0 }
  isAvailable() { return true }
  setSampleRate(_rate: number) {}
  setPitchLock(_enabled: boolean) {}
  setDisplaySamples(_count: number) {}
  pushSamples(_samples: Float32Array) {}
  processContinuous() {
    if (!this.wave.samples.length) return null
    return { samplesToShow: this.wave.samples.length, detectedPitch: this.wave.detectedPitch,
      triggerIndex: 0, writePos: this.wave.samples.length }
  }
  fillSamples(_start: number, output: Float32Array) {
    const count = Math.min(output.length, this.wave.samples.length)
    output.set(this.wave.samples.subarray(0, count))
    return count
  }
  reset() {}
}

class SpectrogramSnapshot implements SpectrogramNativeAnalyzer {
  queue: SpectrogramColumns[] = []
  configure(_options: SpectrogramNativeOptions) {}
  process(_audio: Float32Array) { return this.queue.shift() || null }
  processStereo(_left: Float32Array, _right: Float32Array) { return this.queue.shift() || null }
  reset() { this.queue = [] }
  isAvailable() { return true }
  pending() {
    const empty = new Float32Array(0)
    return this.queue.map(() => ({ left: empty, right: empty }))
  }
}

class WaveformSnapshot implements WaveformNativeAnalyzer {
  queue: Float32Array[] = []
  private readonly trigger = new Float32Array(1)
  isAvailable() { return true }
  configure(_sampleRate: number, _samplesPerColumn: number) {}
  processMono(_samples: Float32Array) { return this.queue.shift() || new Float32Array(0) }
  processStereo(_left: Float32Array, _right: Float32Array) { return this.queue.shift() || new Float32Array(0) }
  reset() { this.queue = [] }
  pending() { return this.queue.map(() => ({ left: this.trigger, right: this.trigger })) }
}

class VuSnapshot implements VUMeterNativeAnalyzer {
  current: VUMeterNativeSnapshot = { vuLDb: -60, vuRDb: -60, barLDb: -60, barRDb: -60,
    peakLDb: -60, peakRDb: -60, correlation: 0 }
  isAvailable() { return true }
  setSampleRate(_sampleRate: number) {}
  pushSamples(_left: Float32Array, _right: Float32Array) {}
  getSnapshot() { return this.current }
  reset() {}
  set(values: Float32Array, offset: number) {
    this.current = { vuLDb: values[offset], vuRDb: values[offset + 1],
      barLDb: values[offset + 2], barRDb: values[offset + 3],
      peakLDb: values[offset + 4], peakRDb: values[offset + 5],
      correlation: values[offset + 6] }
  }
}

class LoudnessSnapshot implements LUFSMeterNativeAnalyzer {
  current: LUFSMeterNativeSnapshot = { momentaryLUFS: -60, shortTermLUFS: -60,
    integratedLUFS: -60, vuLDb: -60, vuRDb: -60, barLDb: -60, barRDb: -60,
    truePeakLDb: -60, truePeakRDb: -60, maxTruePeakDb: -60, correlation: 0 }
  isAvailable() { return true }
  setSampleRate(_sampleRate: number) {}
  pushSamples(_left: Float32Array, _right: Float32Array) {}
  getSnapshot() { return this.current }
  reset() {}
  set(values: Float32Array) {
    if (values.length !== 11) throw new Error('Invalid loudness frame data')
    this.current = { momentaryLUFS: values[0], shortTermLUFS: values[1], integratedLUFS: values[2],
      vuLDb: values[3], vuRDb: values[4], barLDb: values[5], barRDb: values[6],
      truePeakLDb: values[7], truePeakRDb: values[8], maxTruePeakDb: values[9],
      correlation: values[10] }
  }
}

class WaterfallSnapshot implements WaterfallNativeAnalyzer {
  current: WaterfallFrame | null = null
  configure(_options: Parameters<WaterfallNativeAnalyzer['configure']>[0]) {}
  processStereo(_left: Float32Array, _right: Float32Array) {}
  getFrame(_ridges: number, _columns: number) { return this.current }
  reset() { this.current = null }
  isAvailable() { return true }
}

type Meter = {
  canvas: HTMLCanvasElement; type: Layer['type']; signature: string
  painter: Vectorscope | SpectrumAnalyzer | Oscilloscope | Spectrogram | Waveform | VUMeter | LUFSMeter | Waterfall
  snapshot?: SpectrumSnapshot | OscilloscopeSnapshot | SpectrogramSnapshot | WaveformSnapshot | VuSnapshot | LoudnessSnapshot | WaterfallSnapshot
  lastSpectrogramFrame?: SpectrogramFrame
  lastWaveformFrame?: WaveformFrame
  lastVuFrame?: VuFrame
}

export class Composition {
  private context: CanvasRenderingContext2D
  private meters = new Map<string, Meter>()
  private images = new Map<string, HTMLImageElement>()
  private analysis: AnalysisFrame = { vectorscope: { x: new Float32Array(0), y: new Float32Array(0), multiband: new Float32Array(0) },
    spectra: {}, oscilloscopes: {}, spectrograms: {}, waveforms: {}, vus: {}, loudness: {}, waterfalls: {} }
  private sampleRate = 48000
  private source = {
    getSampleRate: () => this.sampleRate,
    isPlaying: () => true,
    subscribeToSessionChanges: (_listener: unknown) => () => {},
    getPendingVectorscopeSamples: () => [],
    getPendingSpectrumSamples: () => [],
    getPendingSpectrumStereoSamples: () => [],
    getPendingOscilloscopeSamples: () => [],
  }
  private vectorscopeSnapshot = {
    isAvailable: () => true,
    setSampleRate: (_rate: number) => {},
    reset: () => {},
    pushSamples: (_left: Float32Array, _right: Float32Array) => {},
    pushMultibandSamples: (_left: Float32Array, _right: Float32Array) => {},
    isMultibandAvailable: () => true,
    getMultibandPoints: (maxPoints: number) => {
      const data = this.analysis.vectorscope.multiband
      const count = Math.min(Math.floor(data.length / 6), maxPoints)
      return { count, data: data.subarray(0, count * 6) }
    },
    fillPoints: (x: Float32Array, y: Float32Array) => {
      const points = this.analysis.vectorscope
      const count = Math.min(points.x.length, points.y.length, x.length, y.length)
      x.set(points.x.subarray(0, count))
      y.set(points.y.subarray(0, count))
      return count
    },
  }

  constructor(private canvas: HTMLCanvasElement) {
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Could not create composition canvas')
    this.context = context
  }

  async setAssets(data: Record<string, string>): Promise<void> {
    const next = new Map<string, HTMLImageElement>()
    for (const [path, url] of Object.entries(data)) {
      if (!/^data:image\/(png|jpeg|webp);base64,/.test(url)) throw new Error('Invalid local image data')
      const image = new Image()
      image.src = url
      await image.decode()
      next.set(path, image)
    }
    this.images = next
  }

  private drawImageBox(image: HTMLImageElement, x: number, y: number, w: number, h: number, fit: 'cover' | 'contain'): void {
    const ctx = this.context
    const factor = fit === 'cover' ? Math.max(w / image.naturalWidth, h / image.naturalHeight)
      : Math.min(w / image.naturalWidth, h / image.naturalHeight)
    const iw = image.naturalWidth * factor
    const ih = image.naturalHeight * factor
    ctx.save()
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip()
    ctx.drawImage(image, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih)
    ctx.restore()
  }

  private drawGraphic(layer: ImageLayer | TextLayer): void {
    const ctx = this.context
    ctx.save()
    ctx.globalAlpha = layer.opacity
    ctx.translate(layer.x + layer.w / 2, layer.y + layer.h / 2)
    ctx.rotate(layer.rotation * Math.PI / 180)
    if (layer.shadow) {
      ctx.shadowColor = 'rgba(0,0,0,0.85)'
      ctx.shadowBlur = layer.shadow
      ctx.shadowOffsetY = Math.min(12, layer.shadow / 3)
    }
    if (layer.type === 'image') {
      const image = this.images.get(layer.imagePath)
      if (image) this.drawImageBox(image, -layer.w / 2, -layer.h / 2, layer.w, layer.h, layer.fit)
    } else {
      ctx.beginPath(); ctx.rect(-layer.w / 2, -layer.h / 2, layer.w, layer.h); ctx.clip()
      ctx.fillStyle = layer.color
      ctx.font = `${layer.fontWeight} ${layer.fontSize}px ${JSON.stringify(layer.fontFamily)}`
      ctx.textAlign = layer.align
      ctx.textBaseline = 'middle'
      const x = layer.align === 'left' ? -layer.w / 2 : layer.align === 'right' ? layer.w / 2 : 0
      ctx.fillText(layer.text, x, 0, layer.w)
    }
    ctx.restore()
  }

  private createMeter(layer: MeterLayer, width: number, height: number, signature: string): Meter {
    const surface = document.createElement('canvas')
    surface.width = width
    surface.height = height
    if (layer.type === 'vectorscope') {
      return { canvas: surface, type: layer.type, signature,
        painter: new Vectorscope(surface, { dataSource: this.source, nativeAnalyzer: this.vectorscopeSnapshot,
          displayPoints: 1024, persistence: 0, lineColor: layer.color, lineWidth: 1.5,
          mode: layer.mode, zoomDb: layer.zoomDb, multiband: layer.multiband,
          showGrid: layer.showGrid, bandColors: { low: layer.bandLowColor,
            mid: layer.bandMidColor, high: layer.bandHighColor } }) }
    }
    if (layer.type === 'oscilloscope') {
      const snapshot = new OscilloscopeSnapshot()
      return { canvas: surface, type: layer.type, signature, snapshot,
        painter: new Oscilloscope(surface, { dataSource: this.source, nativeAnalyzer: snapshot,
          pitchLock: layer.pitchLock, underfillEnabled: layer.underfillEnabled,
          showGrid: layer.showGrid, lineColor: layer.color, lineWidth: 1.5,
          backgroundColor: 'transparent' }) }
    }
    if (layer.type === 'spectrogram') {
      const snapshot = new SpectrogramSnapshot()
      const source = { ...this.source,
        getPendingSpectrogramSamples: () => [],
        getPendingSpectrogramStereoSamples: () => snapshot.pending() }
      return { canvas: surface, type: layer.type, signature, snapshot,
        painter: new Spectrogram(surface, { dataSource: source, nativeAnalyzer: snapshot,
          fftSize: layer.fftSize, scaleMode: layer.scaleMode, orientation: layer.orientation,
          minFrequency: layer.minFrequency, maxFrequency: layer.maxFrequency,
          minDecibels: layer.minDecibels, maxDecibels: layer.maxDecibels,
          scrollSpeed: layer.scrollSpeed, contrast: layer.contrast,
          tiltDbPerOctave: layer.tiltDbPerOctave, clarityMode: layer.clarityMode,
          colorScheme: layer.colorScheme, showGrid: layer.showGrid,
          lineColor: layer.color, backgroundColor: 'transparent' }) }
    }
    if (layer.type === 'waveform') {
      const snapshot = new WaveformSnapshot()
      const source = { ...this.source,
        getPendingWaveformSamples: () => [],
        getPendingWaveformStereoSamples: () => [],
        getPendingWaveformAnnotatedSamples: () => snapshot.pending() }
      return { canvas: surface, type: layer.type, signature, snapshot,
        painter: new Waveform(surface, { dataSource: source, nativeAnalyzer: snapshot,
          mode: layer.mode, scrollSpeed: layer.scrollSpeed, multiband: layer.multiband,
          lineColor: layer.color, bandColors: { low: layer.bandLowColor,
            mid: layer.bandMidColor, high: layer.bandHighColor }, backgroundColor: 'transparent' }) }
    }
    if (layer.type === 'vu') {
      const snapshot = new VuSnapshot()
      const source = { ...this.source, getPendingVUMeterSamples: () => [] }
      return { canvas: surface, type: layer.type, signature, snapshot,
        painter: new VUMeter(surface, { dataSource: source, nativeAnalyzer: snapshot,
          mode: layer.mode, orientation: layer.orientation,
          needleChannels: layer.needleChannels, referenceDb: layer.referenceDb,
          lineColor: layer.color, peakColor: layer.peakColor,
          needleLeftColor: layer.needleLeftColor, needleRightColor: layer.needleRightColor,
          needleCombinedColor: layer.needleCombinedColor, backgroundColor: 'transparent' }) }
    }
    if (layer.type === 'loudness') {
      const snapshot = new LoudnessSnapshot()
      const source = { ...this.source, getPendingLUFSMeterSamples: () => [] }
      return { canvas: surface, type: layer.type, signature, snapshot,
        painter: new LUFSMeter(surface, { dataSource: source, nativeAnalyzer: snapshot,
          mode: 'bar', readout: layer.readout, lineColor: layer.color,
          targetColor: layer.targetColor, backgroundColor: 'transparent' }) }
    }
    if (layer.type === 'waterfall') {
      const snapshot = new WaterfallSnapshot()
      const source = { ...this.source, getPendingWaterfallSamples: () => [] }
      return { canvas: surface, type: layer.type, signature, snapshot,
        painter: new Waterfall(surface, { dataSource: source, nativeAnalyzer: snapshot,
          fftSize: layer.fftSize, scaleMode: layer.scaleMode, frequencyRangeMode: layer.frequencyRangeMode,
          historySeconds: layer.historySeconds, density: layer.density, colorMode: layer.colorMode,
          smoothing: layer.smoothing, tiltDbPerOctave: layer.tiltDbPerOctave, showGrid: layer.showGrid,
          lineColor: layer.color, backgroundColor: 'transparent' }) }
    }
    const snapshot = new SpectrumSnapshot()
    return { canvas: surface, type: layer.type, signature, snapshot,
      painter: new SpectrumAnalyzer(surface, { dataSource: this.source, nativeAnalyzer: snapshot,
        fftSize: layer.fftSize, smoothing: layer.smoothing, scaleType: layer.scaleType,
        minFrequency: layer.minFrequency, maxFrequency: layer.maxFrequency,
        minDecibels: layer.minDecibels, maxDecibels: layer.maxDecibels,
        showSideLine: layer.showSideLine, lineColor: layer.color,
        secondaryLineColor: '#ed89f5', lineWidth: 1.5, fillGradient: false,
        backgroundColor: 'transparent' }) }
  }

  render(raw: Project, analysis: AnalysisFrame, frameIndex: number, sampleRate: number): void {
    const project = normalizeProject(raw) as Project
    if (!Number.isSafeInteger(frameIndex) || frameIndex < 0) throw new Error('Invalid frame index')
    this.analysis = analysis
    this.sampleRate = sampleRate
    const { canvas, context } = this
    const sx = canvas.width / project.width
    const sy = canvas.height / project.height
    const background = project.background
    context.fillStyle = typeof background === 'string' ? background : background.color
    context.fillRect(0, 0, canvas.width, canvas.height)
    if (typeof background !== 'string') {
      if (background.type === 'gradient') {
        const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height)
        gradient.addColorStop(0, background.color); gradient.addColorStop(1, background.color2)
        context.fillStyle = gradient; context.fillRect(0, 0, canvas.width, canvas.height)
      } else if (background.type === 'image') {
        const image = this.images.get(background.imagePath)
        if (image) this.drawImageBox(image, 0, 0, canvas.width, canvas.height, background.fit)
      }
    } else {
      context.save()
      context.scale(sx, sy)
      context.fillStyle = '#e7f9ff'; context.font = 'bold 52px Arial'
      context.fillText(project.title, 80, 90, 1120)
      context.font = '26px Arial'; context.fillStyle = '#a4b4c8'
      context.fillText('Prism audio meters', 84, 132)
      context.font = '23px Arial'
      context.fillText(`t = ${(frameIndex / project.fps).toFixed(2)} s`, 84, 645)
      context.restore()
    }

    const active = new Set(project.layers.map(layer => layer.id))
    for (const [id, meter] of this.meters) {
      if (!active.has(id)) { meter.painter.dispose(); this.meters.delete(id) }
    }
    for (const layer of project.layers) {
      if (!layer.visible || layer.opacity === 0) continue
      if (layer.type === 'image' || layer.type === 'text') {
        context.save(); context.scale(sx, sy); this.drawGraphic(layer); context.restore()
        continue
      }
      const signature = layer.type === 'vectorscope' ? JSON.stringify([layer.type, layer.color,
        layer.mode, layer.zoomDb, layer.multiband, layer.showGrid, layer.showCorrelation,
        layer.bandLowColor, layer.bandMidColor, layer.bandHighColor])
        : layer.type === 'oscilloscope'
          ? JSON.stringify([layer.type, layer.color, layer.pitchLock, layer.underfillEnabled, layer.showGrid])
          : layer.type === 'spectrogram'
            ? JSON.stringify([layer.type, layer.color, layer.fftSize, layer.scaleMode, layer.orientation,
              layer.minFrequency, layer.maxFrequency, layer.minDecibels, layer.maxDecibels,
              layer.scrollSpeed, layer.contrast, layer.tiltDbPerOctave, layer.clarityMode,
              layer.colorScheme, layer.showGrid])
          : layer.type === 'waveform'
            ? JSON.stringify([layer.type, layer.color, layer.mode, layer.scrollSpeed, layer.multiband,
              layer.bandLowColor, layer.bandMidColor, layer.bandHighColor])
          : layer.type === 'vu'
            ? JSON.stringify([layer.type, layer.color, layer.mode, layer.orientation,
              layer.needleChannels, layer.referenceDb, layer.peakColor,
              layer.needleLeftColor, layer.needleRightColor, layer.needleCombinedColor])
          : layer.type === 'loudness'
            ? JSON.stringify([layer.type, layer.color, layer.readout, layer.targetColor])
          : layer.type === 'waterfall'
            ? JSON.stringify([layer.type, layer.color, layer.fftSize, layer.scaleMode,
              layer.frequencyRangeMode, layer.historySeconds, layer.density, layer.colorMode,
              layer.smoothing, layer.tiltDbPerOctave, layer.showGrid])
          : JSON.stringify([layer.type, layer.color, layer.fftSize, layer.smoothing, layer.scaleType,
            layer.minFrequency, layer.maxFrequency, layer.minDecibels, layer.maxDecibels, layer.showSideLine])
      const width = Math.max(1, Math.round(layer.w * sx))
      const height = Math.max(1, Math.round(layer.h * sy))
      let meter = this.meters.get(layer.id)
      if (meter && meter.signature !== signature) {
        meter.painter.dispose(); this.meters.delete(layer.id); meter = undefined
      }
      if (!meter) {
        meter = this.createMeter(layer, width, height, signature)
        this.meters.set(layer.id, meter)
      } else if (layer.type === 'waveform' && (meter.canvas.width !== width || meter.canvas.height !== height)) {
        meter.painter.dispose()
        meter = this.createMeter(layer, width, height, signature)
        this.meters.set(layer.id, meter)
      } else if (meter.canvas.width !== width || meter.canvas.height !== height) {
        meter.canvas.width = width
        meter.canvas.height = height
        meter.painter.resize()
      }
      if (layer.type === 'spectrum') {
        ;(meter.snapshot as SpectrumSnapshot).bins = analysis.spectra[`${layer.fftSize}:${layer.smoothing}`]
          || { mid: new Float32Array(0), side: new Float32Array(0) }
      } else if (layer.type === 'oscilloscope') {
        ;(meter.snapshot as OscilloscopeSnapshot).wave = analysis.oscilloscopes[layer.pitchLock ? 'locked' : 'free']
          || { samples: new Float32Array(0), detectedPitch: 0, triggerIndex: 0 }
      } else if (layer.type === 'spectrogram') {
        const frame = analysis.spectrograms[layer.id]
        if (frame && frame !== meter.lastSpectrogramFrame) {
          if (frame.rebuild && meter.lastSpectrogramFrame) {
            meter.painter.dispose()
            meter = this.createMeter(layer, width, height, signature)
            this.meters.set(layer.id, meter)
          }
          ;(meter.snapshot as SpectrogramSnapshot).queue = [...frame.entries]
          meter.lastSpectrogramFrame = frame
        }
      } else if (layer.type === 'waveform') {
        const frame = analysis.waveforms[layer.id]
        if (frame && frame !== meter.lastWaveformFrame) {
          if (frame.rebuild && meter.lastWaveformFrame) {
            meter.painter.dispose()
            meter = this.createMeter(layer, width, height, signature)
            this.meters.set(layer.id, meter)
          }
          ;(meter.snapshot as WaveformSnapshot).queue = [...frame.entries]
          meter.lastWaveformFrame = frame
        }
      } else if (layer.type === 'vu') {
        const frame = analysis.vus[layer.id]
        if (frame && frame !== meter.lastVuFrame) {
          if (frame.rebuild && meter.lastVuFrame) {
            meter.painter.dispose()
            meter = this.createMeter(layer, width, height, signature)
            this.meters.set(layer.id, meter)
          }
          const values = frame.values
          if (values.length % 7 !== 0) throw new Error('Invalid VU frame data')
          const snapshot = meter.snapshot as VuSnapshot
          const painter = meter.painter as VUMeter & { advanceFrame(nowMs: number): void }
          for (let index = 0; index < values.length / 7; index++) {
            snapshot.set(values, index * 7)
            if (index + 1 < values.length / 7) painter.advanceFrame((frame.startFrame + index) * 1000 / 30)
          }
          meter.lastVuFrame = frame
        }
      } else if (layer.type === 'loudness') {
        const frame = analysis.loudness[layer.id]
        if (frame) (meter.snapshot as LoudnessSnapshot).set(frame)
      } else if (layer.type === 'waterfall') {
        ;(meter.snapshot as WaterfallSnapshot).current = analysis.waterfalls[layer.id] || null
      }
      if (layer.type === 'vu') {
        ;(meter.painter as VUMeter & { renderFrame(nowMs: number): void }).renderFrame(frameIndex * 1000 / project.fps)
      } else {
        ;(meter.painter as (Vectorscope | SpectrumAnalyzer | Oscilloscope | Spectrogram | Waveform | LUFSMeter | Waterfall) & { renderFrame(): void }).renderFrame()
      }
      if (layer.type === 'vectorscope' && layer.showCorrelation) {
        drawCorrelationOverlay(meter.canvas, layer, analysis.vectorscope)
      }
      context.save()
      context.globalAlpha = layer.opacity
      context.translate((layer.x + layer.w / 2) * sx, (layer.y + layer.h / 2) * sy)
      context.rotate(layer.rotation * Math.PI / 180)
      context.drawImage(meter.canvas, -layer.w * sx / 2, -layer.h * sy / 2, layer.w * sx, layer.h * sy)
      context.restore()
    }
  }

  dispose(): void {
    for (const meter of this.meters.values()) meter.painter.dispose()
    this.meters.clear()
  }
}

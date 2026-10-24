import { Vectorscope } from '../upstream/prism/src/renderer/visualizers/Vectorscope'
import { SpectrumAnalyzer } from '../upstream/prism/src/renderer/visualizers/SpectrumAnalyzer'
import { Oscilloscope } from '../upstream/prism/src/renderer/visualizers/Oscilloscope'
import { Spectrogram } from '../upstream/prism/src/renderer/visualizers/Spectrogram'
import { Waveform } from '../upstream/prism/src/renderer/visualizers/Waveform'
import { VUMeter } from '../upstream/prism/src/renderer/visualizers/VUMeter'
import type { SpectrumNativeAnalyzer, OscilloscopeNativeAnalyzer, SpectrogramNativeAnalyzer, WaveformNativeAnalyzer, VUMeterNativeAnalyzer } from '../upstream/prism/src/renderer/audio/native'
import type { SpectrogramNativeOptions, SpectrogramNativeResult, VUMeterNativeSnapshot } from '../upstream/prism/src/renderer/audio/native/visualizer-dsp'
import { normalizeProject } from './project.cjs'

type BaseLayer = {
  id: string; name: string; x: number; y: number; w: number; h: number
  visible: boolean; locked: boolean; opacity: number; color: string
}
export type VectorscopeLayer = BaseLayer & { type: 'vectorscope' }
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
export type Layer = VectorscopeLayer | SpectrumLayer | OscilloscopeLayer | SpectrogramLayer | WaveformLayer | VuLayer
export type Project = {
  version: number; width: number; height: number; fps: number; title: string
  background: string; audioPath: string; layers: Layer[]
}
export type Points = { x: Float32Array; y: Float32Array }
export type SpectrumBins = { mid: Float32Array; side: Float32Array }
export type OscilloscopeWave = { samples: Float32Array; detectedPitch: number; triggerIndex: number }
export type SpectrogramColumns = SpectrogramNativeResult
export type SpectrogramFrame = { rebuild: boolean; entries: SpectrogramColumns[] }
export type WaveformFrame = { rebuild: boolean; entries: Float32Array[] }
export type VuFrame = { rebuild: boolean; startFrame: number; values: Float32Array }
export type AnalysisFrame = { vectorscope: Points; spectra: Record<string, SpectrumBins>;
  oscilloscopes: Record<string, OscilloscopeWave>; spectrograms: Record<string, SpectrogramFrame>;
  waveforms: Record<string, WaveformFrame>; vus: Record<string, VuFrame> }

export function decodeFloats(encoded: string): Float32Array {
  const binary = atob(encoded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Float32Array(bytes.buffer)
}

export function decodeAnalysis(encoded: { x: string; y: string;
  spectra?: Record<string, { mid: string; side: string }>;
  oscilloscopes?: Record<string, { samples: string; detectedPitch: number; triggerIndex: number }>;
  spectrograms?: Record<string, { rebuild: boolean; entries: Array<{
    columnCount: number; rowCount: number; display: string; heat: string }> }>;
  waveforms?: Record<string, { rebuild: boolean; entries: Array<{ columns: number; summary: string }> }>;
  vus?: Record<string, { rebuild: boolean; startFrame: number; values: string }> }): AnalysisFrame {
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
  return { vectorscope: { x: decodeFloats(encoded.x), y: decodeFloats(encoded.y) }, spectra, oscilloscopes, spectrograms, waveforms, vus }
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

type Meter = {
  canvas: HTMLCanvasElement; type: Layer['type']; signature: string
  painter: Vectorscope | SpectrumAnalyzer | Oscilloscope | Spectrogram | Waveform | VUMeter
  snapshot?: SpectrumSnapshot | OscilloscopeSnapshot | SpectrogramSnapshot | WaveformSnapshot | VuSnapshot
  lastSpectrogramFrame?: SpectrogramFrame
  lastWaveformFrame?: WaveformFrame
  lastVuFrame?: VuFrame
}

export class Composition {
  private context: CanvasRenderingContext2D
  private meters = new Map<string, Meter>()
  private analysis: AnalysisFrame = { vectorscope: { x: new Float32Array(0), y: new Float32Array(0) },
    spectra: {}, oscilloscopes: {}, spectrograms: {}, waveforms: {}, vus: {} }
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

  private createMeter(layer: Layer, width: number, height: number, signature: string): Meter {
    const surface = document.createElement('canvas')
    surface.width = width
    surface.height = height
    if (layer.type === 'vectorscope') {
      return { canvas: surface, type: layer.type, signature,
        painter: new Vectorscope(surface, { dataSource: this.source, nativeAnalyzer: this.vectorscopeSnapshot,
          displayPoints: 1024, persistence: 0, lineColor: layer.color, lineWidth: 1.5 }) }
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
    context.fillStyle = project.background
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.save()
    context.scale(sx, sy)
    context.fillStyle = '#e7f9ff'
    context.font = 'bold 52px Arial'
    context.fillText(project.title, 80, 90, 1120)
    context.font = '26px Arial'
    context.fillStyle = '#a4b4c8'
    context.fillText('Prism audio meters', 84, 132)
    context.font = '23px Arial'
    context.fillText(`t = ${(frameIndex / project.fps).toFixed(2)} s`, 84, 645)
    context.restore()

    const active = new Set(project.layers.map(layer => layer.id))
    for (const [id, meter] of this.meters) {
      if (!active.has(id)) { meter.painter.dispose(); this.meters.delete(id) }
    }
    for (const layer of project.layers) {
      if (!layer.visible || layer.opacity === 0) continue
      const signature = layer.type === 'vectorscope' ? `${layer.type}:${layer.color}`
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
      }
      if (layer.type === 'vu') {
        ;(meter.painter as VUMeter & { renderFrame(nowMs: number): void }).renderFrame(frameIndex * 1000 / project.fps)
      } else {
        ;(meter.painter as (Vectorscope | SpectrumAnalyzer | Oscilloscope | Spectrogram | Waveform) & { renderFrame(): void }).renderFrame()
      }
      context.save()
      context.globalAlpha = layer.opacity
      context.drawImage(meter.canvas, layer.x * sx, layer.y * sy, layer.w * sx, layer.h * sy)
      context.restore()
    }
  }

  dispose(): void {
    for (const meter of this.meters.values()) meter.painter.dispose()
    this.meters.clear()
  }
}

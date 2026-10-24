import { Vectorscope } from '../upstream/prism/src/renderer/visualizers/Vectorscope'
import { SpectrumAnalyzer } from '../upstream/prism/src/renderer/visualizers/SpectrumAnalyzer'
import type { SpectrumNativeAnalyzer } from '../upstream/prism/src/renderer/audio/native'
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
export type Layer = VectorscopeLayer | SpectrumLayer
export type Project = {
  version: number; width: number; height: number; fps: number; title: string
  background: string; audioPath: string; layers: Layer[]
}
export type Points = { x: Float32Array; y: Float32Array }
export type SpectrumBins = { mid: Float32Array; side: Float32Array }
export type AnalysisFrame = { vectorscope: Points; spectra: Record<string, SpectrumBins> }

export function decodeFloats(encoded: string): Float32Array {
  const binary = atob(encoded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Float32Array(bytes.buffer)
}

export function decodeAnalysis(encoded: { x: string; y: string; spectra?: Record<string, { mid: string; side: string }> }): AnalysisFrame {
  const spectra: Record<string, SpectrumBins> = {}
  for (const [key, value] of Object.entries(encoded.spectra || {})) {
    spectra[key] = { mid: decodeFloats(value.mid), side: decodeFloats(value.side) }
  }
  return { vectorscope: { x: decodeFloats(encoded.x), y: decodeFloats(encoded.y) }, spectra }
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

type Meter = {
  canvas: HTMLCanvasElement; type: Layer['type']; signature: string
  painter: Vectorscope | SpectrumAnalyzer; snapshot?: SpectrumSnapshot
}

export class Composition {
  private context: CanvasRenderingContext2D
  private meters = new Map<string, Meter>()
  private analysis: AnalysisFrame = { vectorscope: { x: new Float32Array(0), y: new Float32Array(0) }, spectra: {} }
  private sampleRate = 48000
  private source = {
    getSampleRate: () => this.sampleRate,
    isPlaying: () => true,
    subscribeToSessionChanges: (_listener: unknown) => () => {},
    getPendingVectorscopeSamples: () => [],
    getPendingSpectrumSamples: () => [],
    getPendingSpectrumStereoSamples: () => [],
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
      } else if (meter.canvas.width !== width || meter.canvas.height !== height) {
        meter.canvas.width = width
        meter.canvas.height = height
        meter.painter.resize()
      }
      if (layer.type === 'spectrum') {
        meter.snapshot!.bins = analysis.spectra[`${layer.fftSize}:${layer.smoothing}`]
          || { mid: new Float32Array(0), side: new Float32Array(0) }
      }
      ;(meter.painter as (Vectorscope | SpectrumAnalyzer) & { renderFrame(): void }).renderFrame()
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

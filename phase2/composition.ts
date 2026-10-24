import { Vectorscope } from '../upstream/prism/src/renderer/visualizers/Vectorscope'
import { normalizeProject } from './project.cjs'

type Layer = {
  id: string; type: 'vectorscope'; name: string; x: number; y: number; w: number; h: number
  visible: boolean; locked: boolean; opacity: number; color: string
}
export type Project = {
  version: number; width: number; height: number; fps: number; title: string
  background: string; audioPath: string; layers: Layer[]
}
export type Points = { x: Float32Array; y: Float32Array }

export function decodeFloats(encoded: string): Float32Array {
  const binary = atob(encoded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Float32Array(bytes.buffer)
}

export function decodePoints(encoded: { x: string; y: string }): Points {
  return { x: decodeFloats(encoded.x), y: decodeFloats(encoded.y) }
}

export class Composition {
  private context: CanvasRenderingContext2D
  private meters = new Map<string, { canvas: HTMLCanvasElement; scope: Vectorscope; color: string }>()
  private points: Points = { x: new Float32Array(0), y: new Float32Array(0) }
  private sampleRate = 48000
  private source = {
    getSampleRate: () => this.sampleRate,
    isPlaying: () => true,
    subscribeToSessionChanges: (_listener: unknown) => () => {},
    getPendingVectorscopeSamples: () => [],
  }
  private analyzer = {
    isAvailable: () => true,
    setSampleRate: (_rate: number) => {},
    reset: () => {},
    pushSamples: (_left: Float32Array, _right: Float32Array) => {},
    fillPoints: (x: Float32Array, y: Float32Array) => {
      const count = Math.min(this.points.x.length, this.points.y.length, x.length, y.length)
      x.set(this.points.x.subarray(0, count))
      y.set(this.points.y.subarray(0, count))
      return count
    },
  }

  constructor(private canvas: HTMLCanvasElement) {
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Could not create composition canvas')
    this.context = context
  }

  render(raw: Project, points: Points, frameIndex: number, sampleRate: number): void {
    const project = normalizeProject(raw) as Project
    if (!Number.isSafeInteger(frameIndex) || frameIndex < 0) throw new Error('Invalid frame index')
    this.points = points
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
    context.fillText('Prism vectorscope', 84, 132)
    context.font = '23px Arial'
    context.fillText(`t = ${(frameIndex / project.fps).toFixed(2)} s`, 84, 645)
    context.restore()

    const active = new Set(project.layers.map(layer => layer.id))
    for (const [id, meter] of this.meters) {
      if (!active.has(id)) { meter.scope.dispose(); this.meters.delete(id) }
    }
    for (const layer of project.layers) {
      if (!layer.visible || layer.opacity === 0) continue
      let meter = this.meters.get(layer.id)
      const width = Math.max(1, Math.round(layer.w * sx))
      const height = Math.max(1, Math.round(layer.h * sy))
      if (!meter) {
        const surface = document.createElement('canvas')
        surface.width = width
        surface.height = height
        meter = { canvas: surface, color: layer.color,
          scope: new Vectorscope(surface, { dataSource: this.source, nativeAnalyzer: this.analyzer,
            displayPoints: 1024, persistence: 0, lineColor: layer.color, lineWidth: 1.5 }) }
        this.meters.set(layer.id, meter)
      } else {
        if (meter.canvas.width !== width || meter.canvas.height !== height) {
          meter.canvas.width = width
          meter.canvas.height = height
          meter.scope.resize()
        }
        if (meter.color !== layer.color) {
          meter.color = layer.color
          meter.scope.setOptions({ lineColor: layer.color })
        }
      }
      ;(meter.scope as Vectorscope & { renderFrame(): void }).renderFrame()
      context.save()
      context.globalAlpha = layer.opacity
      context.drawImage(meter.canvas, layer.x * sx, layer.y * sy, layer.w * sx, layer.h * sy)
      context.restore()
    }
  }

  dispose(): void {
    for (const meter of this.meters.values()) meter.scope.dispose()
    this.meters.clear()
  }
}

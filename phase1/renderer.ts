import { Vectorscope } from '../upstream/prism/src/renderer/visualizers/Vectorscope'

declare global {
  interface Window {
    phase1: {
      initialize: (width: number, height: number, title: string, fps: number) => void
      render: (x: string, y: string, index: number) => string
    }
  }
}

const output = document.querySelector<HTMLCanvasElement>('#output')!
const meter = document.querySelector<HTMLCanvasElement>('#meter')!
const context = output.getContext('2d')!
let title = ''
let fps = 30
let scope: Vectorscope | null = null
let points = { x: new Float32Array(0), y: new Float32Array(0) }

const analyzer = {
  isAvailable: () => true,
  setSampleRate: (_rate: number) => {},
  reset: () => {},
  pushSamples: (_left: Float32Array, _right: Float32Array) => {},
  fillPoints: (x: Float32Array, y: Float32Array) => {
    const count = Math.min(points.x.length, points.y.length, x.length, y.length)
    x.set(points.x.subarray(0, count))
    y.set(points.y.subarray(0, count))
    return count
  },
}

const source = {
  getSampleRate: () => 48000,
  isPlaying: () => true,
  subscribeToSessionChanges: (_listener: unknown) => () => {},
  getPendingVectorscopeSamples: () => [],
}

function decodeFloats(encoded: string): Float32Array {
  const binary = atob(encoded)
  const view = new DataView(new ArrayBuffer(binary.length))
  for (let i = 0; i < binary.length; i++) view.setUint8(i, binary.charCodeAt(i))
  const floats = new Float32Array(binary.length / 4)
  for (let i = 0; i < floats.length; i++) floats[i] = view.getFloat32(i * 4, true)
  return floats
}

window.phase1 = {
  initialize(width, height, nextTitle, nextFps) {
    output.width = width
    output.height = height
    const size = Math.round(height * 0.69)
    meter.width = size
    meter.height = size
    title = nextTitle
    fps = nextFps
    scope?.dispose()
    scope = new Vectorscope(meter, {
      dataSource: source,
      nativeAnalyzer: analyzer,
      displayPoints: 1024,
      persistence: 0,
      lineColor: '#55f4e8',
      lineWidth: 1.5,
    })
  },
  render(x, y, index) {
    if (!scope) throw new Error('Renderer is not initialized')
    points = { x: decodeFloats(x), y: decodeFloats(y) }
    // Build-time adaptation adds a public renderFrame method to the pinned
    // Prism class. The original drawing implementation remains unchanged.
    ;(scope as Vectorscope & { renderFrame(): void }).renderFrame()
    context.fillStyle = '#101628'
    context.fillRect(0, 0, output.width, output.height)
    const scale = output.height / 720
    context.fillStyle = '#e7f9ff'
    context.font = `bold ${Math.round(52 * scale)}px Arial`
    context.fillText(title, Math.round(80 * scale), Math.round(90 * scale), output.width - 160 * scale)
    context.font = `${Math.round(26 * scale)}px Arial`
    context.fillStyle = '#a4b4c8'
    context.fillText('Prism vectorscope', Math.round(84 * scale), Math.round(132 * scale))
    context.drawImage(meter, Math.round((output.width - meter.width) / 2), Math.round(155 * scale))
    context.font = `${Math.round(23 * scale)}px Arial`
    context.fillText(`t = ${(index / fps).toFixed(2)} s`, Math.round(84 * scale), Math.round(645 * scale))
    return output.toDataURL('image/png').split(',')[1]
  },
}

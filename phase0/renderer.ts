// Phase 0 adapter around Prism's unmodified Canvas painter. The analyzer points
// are computed by Prism's native addon in Electron's main process.
import { Vectorscope } from '../upstream/prism/src/renderer/visualizers/Vectorscope'

declare global {
  interface Window {
    phase0: {
      draw: (x: number[], y: number[], index: number) => string
    }
  }
}

const output = document.querySelector<HTMLCanvasElement>('#output')!
const meter = document.querySelector<HTMLCanvasElement>('#meter')!
const context = output.getContext('2d')!
const points = { x: [] as number[], y: [] as number[] }
const analyzer = {
  isAvailable: () => true,
  setSampleRate: (_rate: number) => {},
  reset: () => {},
  pushSamples: (_left: Float32Array, _right: Float32Array) => {},
  fillPoints: (x: Float32Array, y: Float32Array) => {
    const count = Math.min(points.x.length, points.y.length, x.length, y.length)
    for (let i = 0; i < count; i++) {
      x[i] = points.x[i]
      y[i] = points.y[i]
    }
    return count
  },
}
const source = {
  getSampleRate: () => 48000,
  isPlaying: () => true,
  subscribeToSessionChanges: (_listener: unknown) => () => {},
  getPendingVectorscopeSamples: () => [],
}
const scope = new Vectorscope(meter, {
  dataSource: source,
  nativeAnalyzer: analyzer,
  displayPoints: 1024,
  persistence: 0,
  lineColor: '#55f4e8',
  lineWidth: 1.5,
})

window.phase0 = {
  draw(x, y, index) {
    points.x = x
    points.y = y
    // Prism currently exposes drawing through a private TypeScript method.
    // A production adapter should make this an explicit public renderFrame API.
    ;(scope as unknown as { drawFrame: () => void }).drawFrame()
    context.fillStyle = '#101628'
    context.fillRect(0, 0, output.width, output.height)
    context.fillStyle = '#e7f9ff'
    context.font = 'bold 52px Arial'
    context.fillText('Stereo Phase Study', 80, 90)
    context.font = '26px Arial'
    context.fillStyle = '#a4b4c8'
    context.fillText('Prism vectorscope  •  440 Hz', 84, 132)
    context.drawImage(meter, 390, 155)
    context.font = '23px Arial'
    context.fillText(`t = ${(index / 30).toFixed(2)} s`, 84, 645)
    return output.toDataURL('image/png').split(',')[1]
  },
}

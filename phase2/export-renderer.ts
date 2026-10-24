import { Composition, decodePoints, type Project } from './composition'

declare global {
  interface Window {
    phase2Export: {
      initialize: (project: Project, width: number, height: number, sampleRate: number) => void
      render: (x: string, y: string, frameIndex: number) => string
    }
  }
}

const canvas = document.querySelector<HTMLCanvasElement>('#output')!
let composition: Composition | null = null
let project: Project
let sampleRate = 48000

window.phase2Export = {
  initialize(nextProject, width, height, nextSampleRate) {
    composition?.dispose()
    canvas.width = width
    canvas.height = height
    composition = new Composition(canvas)
    project = nextProject
    sampleRate = nextSampleRate
  },
  render(x, y, frameIndex) {
    if (!composition) throw new Error('Export composition was not initialized')
    composition.render(project, decodePoints({ x, y }), frameIndex, sampleRate)
    return canvas.toDataURL('image/png').split(',')[1]
  },
}

import { Composition, decodeAnalysis, type Project } from './composition'

declare global {
  interface Window {
    phase2Export: {
      initialize: (project: Project, width: number, height: number, sampleRate: number, assets: Record<string, string>) => Promise<void>
      render: (x: string, y: string, multiband: string, spectra: Record<string, { mid: string; side: string }>,
        oscilloscopes: Record<string, { samples: string; detectedPitch: number; triggerIndex: number }>,
        spectrograms: Record<string, { rebuild: boolean; entries: Array<{
          columnCount: number; rowCount: number; display: string; heat: string }> }>,
        waveforms: Record<string, { rebuild: boolean; entries: Array<{ columns: number; summary: string }> }>,
        vus: Record<string, { rebuild: boolean; startFrame: number; values: string }>,
        loudness: Record<string, string>,
        waterfalls: Record<string, { columns: number; audioSeconds: number; levels: string; ages: string; frequencies: string }>,
        frameIndex: number) => string
    }
  }
}

const canvas = document.querySelector<HTMLCanvasElement>('#output')!
let composition: Composition | null = null
let project: Project
let sampleRate = 48000

window.phase2Export = {
  async initialize(nextProject, width, height, nextSampleRate, assets) {
    composition?.dispose()
    canvas.width = width
    canvas.height = height
    composition = new Composition(canvas)
    project = nextProject
    sampleRate = nextSampleRate
    await composition.setAssets(assets)
  },
  render(x, y, multiband, spectra, oscilloscopes, spectrograms, waveforms, vus, loudness, waterfalls, frameIndex) {
    if (!composition) throw new Error('Export composition was not initialized')
    composition.render(project, decodeAnalysis({ x, y, multiband, spectra, oscilloscopes, spectrograms, waveforms, vus, loudness, waterfalls }), frameIndex, sampleRate)
    return canvas.toDataURL('image/png').split(',')[1]
  },
}

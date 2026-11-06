import { Composition, decodeAnalysis, type Project, type AnalysisFrame } from './composition'

export type ThumbnailSource = { assets: Record<string,string>; videoFrame: string; frame: number }
export async function renderProjectThumbnail(project: Project, source: ThumbnailSource,
  analysis?: AnalysisFrame, sampleRate = 48000): Promise<string> {
  const canvas = document.createElement('canvas')
  const scale = 320 / Math.max(project.width,project.height)
  canvas.width = Math.round(project.width*scale); canvas.height = Math.round(project.height*scale)
  const composition = new Composition(canvas)
  try {
    await composition.setAssets(source.assets)
    await composition.setVideoFrame(source.videoFrame)
    composition.render(project,analysis || decodeAnalysis({x:'',y:'',multiband:'',spectra:{},oscilloscopes:{},spectrograms:{},waveforms:{},vus:{},loudness:{},waterfalls:{}}),source.frame,sampleRate)
    return canvas.toDataURL('image/png')
  } finally {composition.dispose()}
}

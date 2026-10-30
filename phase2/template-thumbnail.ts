import { Composition, type Project, type AnalysisFrame } from './composition'
import { circleArtwork } from './template-thumbnail.cjs'

const previews = new Map<string, Promise<string>>()
export const clearTemplateThumbnails = () => previews.clear()

export function renderTemplateThumbnail(id: string,
  loadPreview: (id: string) => Promise<{ project: Project; assets: Record<string, string> }>): Promise<string> {
  const cached = previews.get(id)
  if (cached) return cached
  const pending = loadPreview(id).then(({ project, assets }) => render(project, assets))
    .catch(error => { previews.delete(id); throw error })
  // Bound memory while keeping repeated opens of the picker inexpensive.
  if (previews.size >= 64) previews.delete(previews.keys().next().value!)
  previews.set(id, pending)
  return pending
}

async function render(layout: Project, assets: Record<string, string>): Promise<string> {
  const project = structuredClone(layout)
  const accent = project.layers.find(layer => !['image', 'text'].includes(layer.type))?.color || '#8be1cf'
  // Match the original circle's proportions to each artwork slot rather than
  // cropping a square sample into portrait or landscape slots.
  for (const layer of project.layers) if (layer.type === 'image') {
    const art = new Image()
    art.src = circleArtwork(accent, layer.w, layer.h)
    await art.decode()
    const artwork = document.createElement('canvas')
    artwork.width = art.naturalWidth; artwork.height = art.naturalHeight
    artwork.getContext('2d')!.drawImage(art, 0, 0)
    const artworkPath = `template-preview-artwork-${layer.id}.png`
    assets[artworkPath] = artwork.toDataURL('image/png')
    layer.imagePath = artworkPath
    layer.visible = true
  }
  const canvas = document.createElement('canvas')
  canvas.width = project.width; canvas.height = project.height
  const painter = new Composition(canvas)
  try {
    await painter.setAssets(assets)
    await document.fonts.ready
    const empty: AnalysisFrame = { vectorscope: { x: new Float32Array(0), y: new Float32Array(0), multiband: new Float32Array(0) },
      spectra: {}, oscilloscopes: {}, spectrograms: {}, waveforms: {}, vus: {}, loudness: {}, waterfalls: {} }
    // Identical to the editor's initial still, before audio is imported.
    painter.render(project, empty, 0, 48000)
    const thumbnail = document.createElement('canvas')
    thumbnail.width = 480
    thumbnail.height = Math.round(480 * project.height / project.width)
    thumbnail.getContext('2d')!.drawImage(canvas, 0, 0, thumbnail.width, thumbnail.height)
    return thumbnail.toDataURL('image/png')
  } finally { painter.dispose() }
}

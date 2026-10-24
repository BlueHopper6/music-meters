const WIDTH = 1280
const HEIGHT = 720
const FPS = 30

function defaultProject() {
  return {
    version: 1, width: WIDTH, height: HEIGHT, fps: FPS,
    title: 'Untitled track', background: '#101628', audioPath: '',
    layers: [{ id: 'scope-1', type: 'vectorscope', name: 'Vectorscope',
      x: 390, y: 170, w: 500, h: 500, visible: true, locked: false,
      opacity: 1, color: '#55f4e8' }],
  }
}

function number(value, name, min, max) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} must be between ${min} and ${max}`)
  }
  return value
}

function color(value, name) {
  if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value)) {
    throw new Error(`${name} must be a six-digit hex color`)
  }
  return value
}

function normalizeProject(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid project document')
  if (raw.version !== 1) throw new Error(`Unsupported project version: ${raw.version}`)
  if (raw.width !== WIDTH || raw.height !== HEIGHT || raw.fps !== FPS) {
    throw new Error('Project must use the 1280×720, 30 FPS composition timebase')
  }
  if (typeof raw.title !== 'string' || raw.title.length > 200) throw new Error('Invalid project title')
  if (typeof raw.audioPath !== 'string' || raw.audioPath.length > 4096) throw new Error('Invalid audio path')
  if (!Array.isArray(raw.layers) || raw.layers.length > 32) throw new Error('Project supports at most 32 layers')
  const seen = new Set()
  const layers = raw.layers.map((layer, index) => {
    if (!layer || typeof layer !== 'object' || layer.type !== 'vectorscope') {
      throw new Error(`Layer ${index + 1} must be a vectorscope`)
    }
    if (typeof layer.id !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(layer.id) || seen.has(layer.id)) {
      throw new Error(`Layer ${index + 1} has an invalid or duplicate ID`)
    }
    seen.add(layer.id)
    if (typeof layer.name !== 'string' || !layer.name.trim() || layer.name.length > 80) {
      throw new Error(`Layer ${index + 1} has an invalid name`)
    }
    const x = number(layer.x, 'X', 0, WIDTH)
    const y = number(layer.y, 'Y', 0, HEIGHT)
    const w = number(layer.w, 'Width', 80, WIDTH)
    const h = number(layer.h, 'Height', 80, HEIGHT)
    if (x + w > WIDTH || y + h > HEIGHT) throw new Error(`Layer ${index + 1} extends outside the canvas`)
    if (typeof layer.visible !== 'boolean' || typeof layer.locked !== 'boolean') {
      throw new Error(`Layer ${index + 1} has invalid visibility or lock state`)
    }
    return { id: layer.id, type: 'vectorscope', name: layer.name,
      x, y, w, h, visible: layer.visible, locked: layer.locked,
      opacity: number(layer.opacity, 'Opacity', 0, 1), color: color(layer.color, 'Meter color') }
  })
  return { version: 1, width: WIDTH, height: HEIGHT, fps: FPS,
    title: raw.title, background: color(raw.background, 'Background'),
    audioPath: raw.audioPath, layers }
}

module.exports = { WIDTH, HEIGHT, FPS, defaultProject, normalizeProject }

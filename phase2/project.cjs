const WIDTH = 1280
const HEIGHT = 720
const FPS = 30
const FFT_SIZES = [1024, 2048, 4096, 8192]

function spectrumLayer(id = 'spectrum-1', name = 'Spectrum analyzer') {
  return { id, type: 'spectrum', name, x: 190, y: 190, w: 900, h: 420,
    visible: true, locked: false, opacity: 1, color: '#f8bb66',
    fftSize: 2048, smoothing: 0.9, scaleType: 'log',
    minFrequency: 20, maxFrequency: 20000,
    minDecibels: -90, maxDecibels: -10, showSideLine: false }
}

function oscilloscopeLayer(id = 'oscilloscope-1', name = 'Oscilloscope') {
  return { id, type: 'oscilloscope', name, x: 190, y: 190, w: 900, h: 420,
    visible: true, locked: false, opacity: 1, color: '#6ce8f4',
    pitchLock: true, underfillEnabled: false, showGrid: true }
}

function spectrogramLayer(id = 'spectrogram-1', name = 'Spectrogram') {
  return { id, type: 'spectrogram', name, x: 190, y: 190, w: 900, h: 420,
    visible: true, locked: false, opacity: 1, color: '#62dafa',
    fftSize: 2048, scaleMode: 'log', orientation: 'horizontal',
    minFrequency: 20, maxFrequency: 20000, minDecibels: -90, maxDecibels: -12,
    scrollSpeed: 2, contrast: 1, tiltDbPerOctave: 4, clarityMode: 'sharper',
    colorScheme: 'heat', showGrid: true }
}

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
    if (!layer || typeof layer !== 'object' || !['vectorscope', 'spectrum', 'oscilloscope', 'spectrogram'].includes(layer.type)) {
      throw new Error(`Layer ${index + 1} must be a supported meter`)
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
    const normalized = { id: layer.id, type: layer.type, name: layer.name,
      x, y, w, h, visible: layer.visible, locked: layer.locked,
      opacity: number(layer.opacity, 'Opacity', 0, 1), color: color(layer.color, 'Meter color') }
    if (layer.type === 'spectrum') {
      if (!FFT_SIZES.includes(layer.fftSize)) throw new Error('Unsupported spectrum FFT size')
      if (!['log', 'mel', 'linear'].includes(layer.scaleType)) throw new Error('Unsupported spectrum frequency scale')
      const minFrequency = number(layer.minFrequency, 'Minimum frequency', 10, 20000)
      const maxFrequency = number(layer.maxFrequency, 'Maximum frequency', 20, 24000)
      if (minFrequency >= maxFrequency) throw new Error('Spectrum frequency range is invalid')
      const minDecibels = number(layer.minDecibels, 'Minimum dB', -120, -20)
      const maxDecibels = number(layer.maxDecibels, 'Maximum dB', -60, 12)
      if (minDecibels >= maxDecibels) throw new Error('Spectrum dB range is invalid')
      if (typeof layer.showSideLine !== 'boolean') throw new Error('Invalid spectrum side-line setting')
      return { ...normalized, fftSize: layer.fftSize,
        smoothing: number(layer.smoothing, 'Spectrum smoothing', 0, 0.99),
        scaleType: layer.scaleType, minFrequency, maxFrequency,
        minDecibels, maxDecibels, showSideLine: layer.showSideLine }
    }
    if (layer.type === 'oscilloscope') {
      for (const setting of ['pitchLock', 'underfillEnabled', 'showGrid']) {
        if (typeof layer[setting] !== 'boolean') throw new Error(`Invalid oscilloscope ${setting} setting`)
      }
      return { ...normalized, pitchLock: layer.pitchLock,
        underfillEnabled: layer.underfillEnabled, showGrid: layer.showGrid }
    }
    if (layer.type === 'spectrogram') {
      if (!FFT_SIZES.includes(layer.fftSize)) throw new Error('Unsupported spectrogram FFT size')
      if (!['log', 'mel', 'linear'].includes(layer.scaleMode)) throw new Error('Unsupported spectrogram frequency scale')
      if (!['horizontal', 'vertical'].includes(layer.orientation)) throw new Error('Unsupported spectrogram orientation')
      if (!['classic', 'focused', 'sharp', 'sharper'].includes(layer.clarityMode)) throw new Error('Unsupported spectrogram clarity mode')
      if (!['heat', 'mono'].includes(layer.colorScheme)) throw new Error('Unsupported spectrogram color scheme')
      const minFrequency = number(layer.minFrequency, 'Spectrogram minimum frequency', 10, 20000)
      const maxFrequency = number(layer.maxFrequency, 'Spectrogram maximum frequency', 20, 24000)
      if (minFrequency >= maxFrequency) throw new Error('Spectrogram frequency range is invalid')
      const minDecibels = number(layer.minDecibels, 'Spectrogram minimum dB', -120, -20)
      const maxDecibels = number(layer.maxDecibels, 'Spectrogram maximum dB', -60, 12)
      if (minDecibels >= maxDecibels) throw new Error('Spectrogram dB range is invalid')
      if (typeof layer.showGrid !== 'boolean') throw new Error('Invalid spectrogram grid setting')
      return { ...normalized, fftSize: layer.fftSize, scaleMode: layer.scaleMode,
        orientation: layer.orientation, minFrequency, maxFrequency,
        minDecibels, maxDecibels, scrollSpeed: number(layer.scrollSpeed, 'Spectrogram speed', 0.5, 8),
        contrast: number(layer.contrast, 'Spectrogram contrast', 0.5, 2),
        tiltDbPerOctave: number(layer.tiltDbPerOctave, 'Spectrogram tilt', -2, 8),
        clarityMode: layer.clarityMode, colorScheme: layer.colorScheme, showGrid: layer.showGrid }
    }
    return normalized
  })
  return { version: 1, width: WIDTH, height: HEIGHT, fps: FPS,
    title: raw.title, background: color(raw.background, 'Background'),
    audioPath: raw.audioPath, layers }
}

module.exports = { WIDTH, HEIGHT, FPS, FFT_SIZES, defaultProject, spectrumLayer, oscilloscopeLayer, spectrogramLayer, normalizeProject }

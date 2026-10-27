const WIDTH = 1280
const HEIGHT = 720
const FPS = 30
const FFT_SIZES = [1024, 2048, 4096, 8192]
const VECTORSCOPE_MODES = ['lissajous', 'polar-unipolar', 'polar-bipolar', 'linear-unipolar', 'linear-bipolar']

function vectorscopeLayer(id = 'scope-1', name = 'Vectorscope') {
  return { id, type: 'vectorscope', name, x: 390, y: 170, w: 500, h: 500,
    visible: true, locked: false, aspectLocked: false, rotation: 0, opacity: 1, color: '#55f4e8',
    mode: 'lissajous', zoomDb: 0, multiband: false, showGrid: true,
    showCorrelation: false, bandLowColor: '#ff4444',
    bandMidColor: '#44dd44', bandHighColor: '#4488ff' }
}

function spectrumLayer(id = 'spectrum-1', name = 'Spectrum analyzer') {
  return { id, type: 'spectrum', name, x: 190, y: 190, w: 900, h: 420,
    visible: true, locked: false, aspectLocked: false, rotation: 0, opacity: 1, color: '#f8bb66',
    fftSize: 2048, smoothing: 0.9, scaleType: 'log',
    minFrequency: 20, maxFrequency: 20000,
    minDecibels: -90, maxDecibels: -10, showSideLine: false }
}

function oscilloscopeLayer(id = 'oscilloscope-1', name = 'Oscilloscope') {
  return { id, type: 'oscilloscope', name, x: 190, y: 190, w: 900, h: 420,
    visible: true, locked: false, aspectLocked: false, rotation: 0, opacity: 1, color: '#6ce8f4',
    pitchLock: true, underfillEnabled: false, showGrid: true }
}

function spectrogramLayer(id = 'spectrogram-1', name = 'Spectrogram') {
  return { id, type: 'spectrogram', name, x: 190, y: 190, w: 900, h: 420,
    visible: true, locked: false, aspectLocked: false, rotation: 0, opacity: 1, color: '#62dafa',
    fftSize: 2048, scaleMode: 'log', orientation: 'horizontal',
    minFrequency: 20, maxFrequency: 20000, minDecibels: -90, maxDecibels: -12,
    scrollSpeed: 2, contrast: 1, tiltDbPerOctave: 4, clarityMode: 'sharper',
    colorScheme: 'heat', showGrid: true }
}

function waveformLayer(id = 'waveform-1', name = 'Waveform history') {
  return { id, type: 'waveform', name, x: 190, y: 190, w: 900, h: 420,
    visible: true, locked: false, aspectLocked: false, rotation: 0, opacity: 1, color: '#38bdf8',
    mode: 'stereo', scrollSpeed: 1, multiband: false,
    bandLowColor: '#ff4444', bandMidColor: '#44dd44', bandHighColor: '#4488ff' }
}

function vuLayer(id = 'vu-1', name = 'VU meter') {
  return { id, type: 'vu', name, x: 190, y: 190, w: 900, h: 420,
    visible: true, locked: false, aspectLocked: false, rotation: 0, opacity: 1, color: '#38bdf8',
    mode: 'bar', orientation: 'horizontal', needleChannels: 'stereo',
    referenceDb: -14, peakColor: '#ff7f00',
    needleLeftColor: '#c7dfff', needleRightColor: '#ff477e',
    needleCombinedColor: '#f4f8ff' }
}

function loudnessLayer(id = 'loudness-1', name = 'Loudness and peak') {
  return { id, type: 'loudness', name, x: 190, y: 190, w: 900, h: 420,
    visible: true, locked: false, aspectLocked: false, rotation: 0, opacity: 1, color: '#38bdf8',
    readout: 'shortTerm', targetColor: '#426a87' }
}

function waterfallLayer(id = 'waterfall-1', name = 'Waterfall spectrum') {
  return { id, type: 'waterfall', name, x: 190, y: 190, w: 900, h: 420,
    visible: true, locked: false, aspectLocked: false, rotation: 0, opacity: 1, color: '#38e5ef',
    fftSize: 2048, scaleMode: 'log', frequencyRangeMode: 'extended',
    historySeconds: 5, density: 'balanced', colorMode: 'theme',
    smoothing: 0.9, tiltDbPerOctave: 2, showGrid: true }
}

function imageLayer(id = 'image-1', name = 'Artwork') {
  return { id, type: 'image', name, x: 72, y: 170, w: 400, h: 400,
    visible: true, locked: false, aspectLocked: false, rotation: 0, opacity: 1, color: '#ffffff',
    imagePath: '', fit: 'cover', shadow: 0 }
}

function textLayer(id = 'text-1', name = 'Song title', text = 'Untitled track') {
  return { id, type: 'text', name, x: 72, y: 64, w: 1120, h: 82,
    visible: true, locked: false, aspectLocked: false, rotation: 0, opacity: 1, color: '#e7f9ff', text,
    fontFamily: 'Arial', fontSize: 52, fontWeight: 'bold', align: 'left',
    shadow: 0 }
}

function compositionProject() {
  return { ...defaultProject(), version: 2,
    background: { type: 'solid', color: '#101628', color2: '#243750', imagePath: '', fit: 'cover' },
    layers: [vectorscopeLayer(), textLayer()] }
}

function defaultProject() {
  return {
    version: 1, width: WIDTH, height: HEIGHT, fps: FPS,
    title: 'Untitled track', background: '#101628', audioPath: '', previewFrame: 0,
    layers: [vectorscopeLayer()],
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

function validFontFamily(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 128
    && value === value.trim() && !/[\u0000-\u001f\u007f"\\]/.test(value)
}

function localImagePath(value, name) {
  if (typeof value !== 'string' || value.length > 4096 || /[\u0000-\u001f]/.test(value)
      || /^[a-z][a-z0-9+.-]*:\/\//i.test(value) || /^file:/i.test(value)
      || (value && !/\.(png|jpe?g|webp)$/i.test(value))) throw new Error(`${name} must be a local PNG, JPEG, or WebP path`)
  return value
}

function background(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid background')
  if (!['solid', 'gradient', 'image'].includes(value.type)) throw new Error('Unsupported background type')
  if (!['cover', 'contain'].includes(value.fit)) throw new Error('Invalid background fit')
  return { type: value.type, color: color(value.color, 'Background color'),
    color2: color(value.color2, 'Second background color'),
    imagePath: localImagePath(value.imagePath, 'Background image'), fit: value.fit }
}

function normalizeProject(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid project document')
  if (raw.version !== 1 && raw.version !== 2) throw new Error(`Unsupported project version: ${raw.version}`)
  const width = raw.width
  const height = raw.height
  if (((width !== WIDTH || height !== HEIGHT) && !(raw.version === 2 && width === HEIGHT && height === WIDTH))
      || raw.fps !== FPS) {
    throw new Error('Project must use a 1280×720 landscape or 720×1280 portrait canvas at 30 FPS')
  }
  if (typeof raw.title !== 'string' || raw.title.length > 200) throw new Error('Invalid project title')
  if (typeof raw.audioPath !== 'string' || raw.audioPath.length > 4096) throw new Error('Invalid audio path')
  const previewFrame = raw.previewFrame === undefined ? 0 : raw.previewFrame
  if (!Number.isSafeInteger(previewFrame) || previewFrame < 0) throw new Error('Invalid preview frame')
  if (!Array.isArray(raw.layers) || raw.layers.length > 32) throw new Error('Project supports at most 32 layers')
  const seen = new Set()
  const layers = raw.layers.map((layer, index) => {
    if (!layer || typeof layer !== 'object' || !['vectorscope', 'spectrum', 'oscilloscope', 'spectrogram', 'waveform', 'vu', 'loudness', 'waterfall', ...(raw.version === 2 ? ['image', 'text'] : [])].includes(layer.type)) {
      throw new Error(`Layer ${index + 1} has an unsupported type`)
    }
    if (typeof layer.id !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(layer.id) || seen.has(layer.id)) {
      throw new Error(`Layer ${index + 1} has an invalid or duplicate ID`)
    }
    seen.add(layer.id)
    if (typeof layer.name !== 'string' || !layer.name.trim() || layer.name.length > 80) {
      throw new Error(`Layer ${index + 1} has an invalid name`)
    }
    const x = number(layer.x, 'X', 0, width)
    const y = number(layer.y, 'Y', 0, height)
    const minimum = layer.type === 'text' ? 20 : layer.type === 'image' ? 40 : 80
    const w = number(layer.w, 'Width', minimum, width)
    const h = number(layer.h, 'Height', minimum, height)
    if (x + w > width || y + h > height) throw new Error(`Layer ${index + 1} extends outside the canvas`)
    if (typeof layer.visible !== 'boolean' || typeof layer.locked !== 'boolean') {
      throw new Error(`Layer ${index + 1} has invalid visibility or lock state`)
    }
    if (layer.aspectLocked !== undefined && typeof layer.aspectLocked !== 'boolean') {
      throw new Error(`Layer ${index + 1} has an invalid aspect lock`)
    }
    const rotation = number(layer.rotation === undefined ? 0 : layer.rotation, 'Rotation', -180, 180)
    const normalized = { id: layer.id, type: layer.type, name: layer.name,
      x, y, w, h, visible: layer.visible, locked: layer.locked,
      aspectLocked: layer.aspectLocked === true, rotation,
      opacity: number(layer.opacity, 'Opacity', 0, 1), color: color(layer.color, 'Meter color') }
    if (layer.type !== 'image' && ['backgroundEnabled', 'backgroundColor', 'backgroundOpacity']
      .some(key => layer[key] !== undefined)) {
      const enabled = layer.backgroundEnabled === undefined ? false : layer.backgroundEnabled
      if (typeof enabled !== 'boolean') throw new Error('Invalid layer background enabled state')
      Object.assign(normalized, {
        backgroundEnabled: enabled,
        backgroundColor: color(layer.backgroundColor === undefined ? '#000000' : layer.backgroundColor, 'Layer background color'),
        backgroundOpacity: number(layer.backgroundOpacity === undefined ? 1 : layer.backgroundOpacity, 'Layer background opacity', 0, 1),
      })
    }
    if (layer.type === 'image' || layer.type === 'text') {
      const shadow = number(layer.shadow, 'Shadow', 0, 40)
      if (layer.type === 'image') {
        if (!['cover', 'contain'].includes(layer.fit)) throw new Error('Invalid image fit')
        return { ...normalized, imagePath: localImagePath(layer.imagePath, 'Artwork'),
          fit: layer.fit, shadow }
      }
      if (typeof layer.text !== 'string' || layer.text.length > 500 || /[\u0000-\u001f]/.test(layer.text)) throw new Error('Invalid text layer content')
      if (!validFontFamily(layer.fontFamily)) throw new Error('Unsupported font')
      if (!['normal', 'bold'].includes(layer.fontWeight) || !['left', 'center', 'right'].includes(layer.align)) throw new Error('Invalid typography')
      return { ...normalized, text: layer.text, fontFamily: layer.fontFamily,
        fontSize: number(layer.fontSize, 'Font size', 12, 160), fontWeight: layer.fontWeight,
        align: layer.align, shadow }
    }
    if (layer.type === 'vectorscope') {
      const defaults = vectorscopeLayer()
      const setting = key => layer[key] === undefined ? defaults[key] : layer[key]
      const mode = setting('mode')
      if (!VECTORSCOPE_MODES.includes(mode)) throw new Error('Unsupported vectorscope mode')
      const zoomDb = number(setting('zoomDb'), 'Vectorscope zoom dB', -12, 24)
      if (!Number.isInteger(zoomDb)) throw new Error('Vectorscope zoom dB must be an integer')
      const multiband = setting('multiband')
      const showGrid = setting('showGrid')
      const showCorrelation = setting('showCorrelation')
      if (typeof multiband !== 'boolean' || typeof showGrid !== 'boolean'
          || typeof showCorrelation !== 'boolean') throw new Error('Invalid vectorscope display setting')
      return { ...normalized, mode, zoomDb, multiband, showGrid, showCorrelation,
        bandLowColor: color(setting('bandLowColor'), 'Vectorscope low band color'),
        bandMidColor: color(setting('bandMidColor'), 'Vectorscope mid band color'),
        bandHighColor: color(setting('bandHighColor'), 'Vectorscope high band color') }
    }
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
    if (layer.type === 'waveform') {
      if (!['mono', 'stereo'].includes(layer.mode)) throw new Error('Unsupported waveform mode')
      if (!Number.isInteger(layer.scrollSpeed)) throw new Error('Waveform speed must be an integer')
      if (typeof layer.multiband !== 'boolean') throw new Error('Invalid waveform multiband setting')
      return { ...normalized, mode: layer.mode,
        scrollSpeed: number(layer.scrollSpeed, 'Waveform speed', 1, 8),
        multiband: layer.multiband,
        bandLowColor: color(layer.bandLowColor, 'Low band color'),
        bandMidColor: color(layer.bandMidColor, 'Mid band color'),
        bandHighColor: color(layer.bandHighColor, 'High band color') }
    }
    if (layer.type === 'vu') {
      if (!['bar', 'needle'].includes(layer.mode)) throw new Error('Unsupported VU display mode')
      if (!['horizontal', 'vertical'].includes(layer.orientation)) throw new Error('Unsupported VU orientation')
      if (!['stereo', 'combined'].includes(layer.needleChannels)) throw new Error('Unsupported VU needle channels')
      return { ...normalized, mode: layer.mode, orientation: layer.orientation,
        needleChannels: layer.needleChannels,
        referenceDb: number(layer.referenceDb, 'VU reference dBFS', -30, 0),
        peakColor: color(layer.peakColor, 'VU peak color'),
        needleLeftColor: color(layer.needleLeftColor, 'VU left needle color'),
        needleRightColor: color(layer.needleRightColor, 'VU right needle color'),
        needleCombinedColor: color(layer.needleCombinedColor, 'VU combined needle color') }
    }
    if (layer.type === 'loudness') {
      if (!['momentary', 'shortTerm', 'integrated'].includes(layer.readout)) {
        throw new Error('Unsupported loudness readout')
      }
      return { ...normalized, readout: layer.readout,
        targetColor: color(layer.targetColor, 'Loudness target color') }
    }
    if (layer.type === 'waterfall') {
      if (![...FFT_SIZES, 16384].includes(layer.fftSize)) throw new Error('Unsupported waterfall FFT size')
      if (!['log', 'mel', 'linear'].includes(layer.scaleMode)) throw new Error('Unsupported waterfall frequency scale')
      if (!['extended', 'audible'].includes(layer.frequencyRangeMode)) throw new Error('Unsupported waterfall frequency range')
      if (!['sparse', 'balanced', 'dense'].includes(layer.density)) throw new Error('Unsupported waterfall density')
      if (!['theme', 'heat'].includes(layer.colorMode)) throw new Error('Unsupported waterfall color mode')
      if (typeof layer.showGrid !== 'boolean') throw new Error('Invalid waterfall grid setting')
      const historySeconds = number(layer.historySeconds, 'Waterfall history seconds', 1, 30)
      if (!Number.isInteger(historySeconds)) throw new Error('Waterfall history seconds must be an integer')
      return { ...normalized, fftSize: layer.fftSize, scaleMode: layer.scaleMode,
        frequencyRangeMode: layer.frequencyRangeMode, historySeconds, density: layer.density,
        colorMode: layer.colorMode, smoothing: number(layer.smoothing, 'Waterfall smoothing', 0, 0.99),
        tiltDbPerOctave: number(layer.tiltDbPerOctave, 'Waterfall tilt', -2, 8), showGrid: layer.showGrid }
    }
    return normalized
  })
  return { version: raw.version, width, height, fps: FPS,
    title: raw.title, background: raw.version === 1 ? color(raw.background, 'Background') : background(raw.background),
    audioPath: raw.audioPath, previewFrame, layers }
}

// Fit as one composition rather than stretching artwork and meter geometry.
function fitLayer(layer, fromWidth, fromHeight, width, height) {
  const scale = Math.min(width / fromWidth, height / fromHeight)
  const minimum = layer.type === 'text' ? 20 : layer.type === 'image' ? 40 : 80
  const w = Math.min(width, Math.max(minimum, Math.round(layer.w * scale)))
  const h = Math.min(height, Math.max(minimum, Math.round(layer.h * scale)))
  const fitted = { ...layer, w, h,
    x: Math.max(0, Math.min(width - w, Math.round(layer.x * scale + (width - fromWidth * scale) / 2))),
    y: Math.max(0, Math.min(height - h, Math.round(layer.y * scale + (height - fromHeight * scale) / 2))) }
  if (layer.type === 'text') fitted.fontSize = Math.max(12, Math.min(160, Math.round(layer.fontSize * scale)))
  if ('shadow' in layer) fitted.shadow = Math.min(40, Math.round(layer.shadow * scale))
  return fitted
}

function orientProject(raw, orientation) {
  if (!['landscape', 'portrait'].includes(orientation)) throw new Error('Unsupported canvas orientation')
  const project = normalizeProject(raw)
  const [width, height] = orientation === 'portrait' ? [HEIGHT, WIDTH] : [WIDTH, HEIGHT]
  if (project.width === width && project.height === height) return project
  if (project.version !== 2) throw new Error('Upgrade legacy composition before changing orientation')
  return normalizeProject({ ...project, width, height,
    layers: project.layers.map(layer => fitLayer(layer, project.width, project.height, width, height)) })
}

function exportDimensions(project, preset) {
  if (!['720p', '1080p'].includes(preset)) throw new Error('Unsupported export preset')
  const scale = preset === '1080p' ? 1.5 : 1
  return { width: Math.round(project.width * scale), height: Math.round(project.height * scale) }
}

module.exports = { WIDTH, HEIGHT, FPS, FFT_SIZES, VECTORSCOPE_MODES, defaultProject, compositionProject, vectorscopeLayer, spectrumLayer, oscilloscopeLayer, spectrogramLayer, waveformLayer, vuLayer, loudnessLayer, waterfallLayer, imageLayer, textLayer, validFontFamily, normalizeProject, fitLayer, orientProject, exportDimensions }

const test = require('node:test')
const assert = require('node:assert/strict')
const { defaultProject, spectrumLayer, oscilloscopeLayer, spectrogramLayer, waveformLayer, vuLayer, loudnessLayer, normalizeProject } = require('../project.cjs')

test('two loudness meters retain distinct readouts and target colors in version 1', () => {
  const project = defaultProject()
  const momentary = { ...loudnessLayer('loudness-m', 'Momentary'), x: 30, y: 160,
    w: 580, h: 440, readout: 'momentary' }
  const integrated = { ...loudnessLayer('loudness-i', 'Integrated'), x: 650, y: 160,
    w: 580, h: 440, readout: 'integrated', targetColor: '#b83268' }
  project.layers.push(momentary, integrated)
  const saved = normalizeProject(project)
  assert.equal(saved.version, 1)
  assert.deepEqual(saved.layers.slice(1), [momentary, integrated])
})

test('rejects invalid loudness readout and target color', () => {
  const project = defaultProject()
  const layer = loudnessLayer()
  project.layers.push(layer)
  layer.readout = 'hourly'
  assert.throws(() => normalizeProject(project), /loudness readout/)
  layer.readout = 'shortTerm'
  layer.targetColor = 'orange'
  assert.throws(() => normalizeProject(project), /Loudness target color/)
})

test('two VU meters retain independent display and calibration settings in version 1', () => {
  const project = defaultProject()
  const bar = { ...vuLayer('vu-bar', 'Bar'), x: 30, y: 150, w: 580, h: 420 }
  const needle = { ...vuLayer('vu-needle', 'Needle'), x: 650, y: 150, w: 580, h: 420,
    mode: 'needle', needleChannels: 'combined', referenceDb: -20, needleCombinedColor: '#ffaa44' }
  project.layers.push(bar, needle)
  const saved = normalizeProject(project)
  assert.equal(saved.version, 1)
  assert.deepEqual(saved.layers.slice(1), [bar, needle])
})

test('rejects invalid VU mode, orientation, channels, reference, and color', () => {
  const invalid = change => {
    const project = defaultProject()
    const layer = vuLayer()
    change(layer)
    project.layers.push(layer)
    return project
  }
  assert.throws(() => normalizeProject(invalid(layer => { layer.mode = 'radial' })), /VU display mode/)
  assert.throws(() => normalizeProject(invalid(layer => { layer.orientation = 'diagonal' })), /VU orientation/)
  assert.throws(() => normalizeProject(invalid(layer => { layer.needleChannels = 'mid' })), /VU needle channels/)
  assert.throws(() => normalizeProject(invalid(layer => { layer.referenceDb = -31 })), /VU reference dBFS/)
  assert.throws(() => normalizeProject(invalid(layer => { layer.peakColor = 'red' })), /VU peak color/)
})

test('default project is a valid 16:9 composition with one real meter layer', () => {
  const project = normalizeProject(defaultProject())
  assert.equal(project.width / project.height, 16 / 9)
  assert.equal(project.fps, 30)
  assert.equal(project.layers.length, 1)
  assert.equal(project.layers[0].type, 'vectorscope')
})

test('rejects invalid geometry and duplicate layer IDs before saving or rendering', () => {
  const outside = defaultProject()
  outside.layers[0].x = 1000
  assert.throws(() => normalizeProject(outside), /outside the canvas/)
  const duplicate = defaultProject()
  duplicate.layers.push({ ...duplicate.layers[0] })
  assert.throws(() => normalizeProject(duplicate), /duplicate ID/)
})

test('rejects unsupported project versions and unsafe color values', () => {
  const old = defaultProject()
  old.version = 2
  assert.throws(() => normalizeProject(old), /Unsupported project version/)
  const badColor = defaultProject()
  badColor.layers[0].color = 'url(file:///secret)'
  assert.throws(() => normalizeProject(badColor), /hex color/)
})

test('spectrum settings survive project normalization alongside vectorscope layers', () => {
  const project = defaultProject()
  const spectrum = spectrumLayer()
  spectrum.fftSize = 4096
  spectrum.smoothing = 0.75
  spectrum.scaleType = 'mel'
  spectrum.showSideLine = true
  project.layers.push(spectrum)
  const value = normalizeProject(project)
  assert.equal(value.layers[0].type, 'vectorscope')
  assert.deepEqual(value.layers[1], spectrum)
})

test('rejects invalid FFT, smoothing, frequency, and dB settings', () => {
  const invalid = change => {
    const project = defaultProject()
    const spectrum = spectrumLayer()
    change(spectrum)
    project.layers.push(spectrum)
    return project
  }
  assert.throws(() => normalizeProject(invalid(layer => { layer.fftSize = 1234 })), /FFT size/)
  assert.throws(() => normalizeProject(invalid(layer => { layer.smoothing = 1 })), /smoothing/)
  assert.throws(() => normalizeProject(invalid(layer => { layer.minFrequency = 20000 })), /frequency range/)
  assert.throws(() => normalizeProject(invalid(layer => { layer.minDecibels = -5 })), /Minimum dB/)
})

test('oscilloscope modes and styles survive project normalization', () => {
  const project = defaultProject()
  const locked = oscilloscopeLayer()
  const free = { ...oscilloscopeLayer('oscilloscope-2', 'Free run'), pitchLock: false,
    underfillEnabled: true, showGrid: false }
  project.layers.push(locked, free)
  const value = normalizeProject(project)
  assert.deepEqual(value.layers.slice(1), [locked, free])
})

test('rejects malformed oscilloscope settings', () => {
  const project = defaultProject()
  const oscilloscope = oscilloscopeLayer()
  oscilloscope.pitchLock = 'yes'
  project.layers.push(oscilloscope)
  assert.throws(() => normalizeProject(project), /oscilloscope pitchLock/)
})

test('two spectrograms retain independent scale, orientation, and color settings', () => {
  const project = defaultProject()
  const horizontal = spectrogramLayer()
  const vertical = { ...spectrogramLayer('spectrogram-2', 'Vertical'),
    x: 10, y: 20, w: 400, h: 350, fftSize: 4096,
    scaleMode: 'mel', orientation: 'vertical', colorScheme: 'mono', showGrid: false }
  project.layers.push(horizontal, vertical)
  assert.deepEqual(normalizeProject(project).layers.slice(1), [horizontal, vertical])
})

test('rejects invalid spectrogram DSP and history settings', () => {
  const invalid = change => {
    const project = defaultProject()
    const layer = spectrogramLayer()
    change(layer)
    project.layers.push(layer)
    return project
  }
  assert.throws(() => normalizeProject(invalid(layer => { layer.orientation = 'diagonal' })), /orientation/)
  assert.throws(() => normalizeProject(invalid(layer => { layer.fftSize = 999 })), /FFT size/)
  assert.throws(() => normalizeProject(invalid(layer => { layer.scrollSpeed = 100 })), /speed/)
  assert.throws(() => normalizeProject(invalid(layer => { layer.maxFrequency = 10 })), /frequency/)
})

test('two waveform layers retain independent channel, speed, and band settings in version 1', () => {
  const project = defaultProject()
  const mono = { ...waveformLayer(), mode: 'mono', multiband: true }
  const stereo = { ...waveformLayer('waveform-2', 'Stereo'), x: 20, y: 20, w: 400, h: 200,
    scrollSpeed: 8, color: '#123456', bandHighColor: '#abcdef' }
  project.layers.push(mono, stereo)
  assert.deepEqual(normalizeProject(project).layers.slice(1), [mono, stereo])
})

test('rejects malformed waveform mode, speed, multiband, and color settings', () => {
  const invalid = change => {
    const project = defaultProject()
    const layer = waveformLayer()
    change(layer)
    project.layers.push(layer)
    return project
  }
  assert.throws(() => normalizeProject(invalid(layer => { layer.mode = 'mid' })), /waveform mode/)
  assert.throws(() => normalizeProject(invalid(layer => { layer.scrollSpeed = 2.5 })), /speed/)
  assert.throws(() => normalizeProject(invalid(layer => { layer.scrollSpeed = 9 })), /speed/)
  assert.throws(() => normalizeProject(invalid(layer => { layer.multiband = 'yes' })), /multiband/)
  assert.throws(() => normalizeProject(invalid(layer => { layer.bandLowColor = 'red' })), /hex color/)
})

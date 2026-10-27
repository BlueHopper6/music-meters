const test = require('node:test')
const assert = require('node:assert/strict')
const { defaultProject, compositionProject, imageLayer, textLayer, vectorscopeLayer, spectrumLayer, oscilloscopeLayer, spectrogramLayer, waveformLayer, vuLayer, loudnessLayer, waterfallLayer, normalizeProject } = require('../project.cjs')
const { encapsulateProjectPath } = require('../project-path.cjs')
const { orientProject, exportDimensions } = require('../project.cjs')

test('portrait projects fit without cropping, retain media and marker, and export at 1080x1920', () => {
  const original = { ...compositionProject(), audioPath: 'song.wav', previewFrame: 30 }
  original.layers.push(imageLayer())
  const portrait = orientProject(original, 'portrait')
  assert.equal(original.width, 1280, 'conversion must not mutate its source')
  assert.deepEqual([portrait.width, portrait.height, portrait.audioPath, portrait.previewFrame], [720, 1280, 'song.wav', 30])
  assert.deepEqual(normalizeProject(JSON.parse(JSON.stringify(portrait))), portrait)
  assert.deepEqual(exportDimensions(portrait, '1080p'), { width: 1080, height: 1920 })
  assert.deepEqual(exportDimensions(portrait, '720p'), { width: 720, height: 1280 })
  for (const layer of portrait.layers) {
    assert.ok(layer.x >= 0 && layer.y >= 0 && layer.x + layer.w <= 720 && layer.y + layer.h <= 1280)
  }
  assert.equal(portrait.layers[0].w, portrait.layers[0].h, 'square meter must stay square')
  assert.deepEqual([orientProject(portrait, 'landscape').width, orientProject(portrait, 'landscape').height], [1280, 720])
  assert.throws(() => normalizeProject({ ...portrait, width: 1080, height: 1920 }), /canvas/)
  assert.throws(() => normalizeProject({ ...portrait, layers: [{ ...portrait.layers[0], y: 1200 }] }), /outside/)
  assert.throws(() => orientProject(portrait, 'square'), /orientation/)
  assert.throws(() => normalizeProject({ ...defaultProject(), width: 720, height: 1280 }), /canvas/)
})

test('layer backgrounds round-trip for text and all meters, with transparent legacy defaults', () => {
  const constructors = [vectorscopeLayer, spectrumLayer, oscilloscopeLayer, spectrogramLayer,
    waveformLayer, vuLayer, loudnessLayer, waterfallLayer, textLayer]
  for (const create of constructors) {
    const layer = create()
    const raw = { ...compositionProject(), layers: [layer] }
    assert.deepEqual(normalizeProject(raw).layers[0], layer, 'legacy layer must not acquire visible styling')
    const styled = { ...layer, backgroundEnabled: true, backgroundColor: '#a13467', backgroundOpacity: 0.4 }
    const project = { ...raw, layers: [styled] }
    assert.deepEqual(normalizeProject(JSON.parse(JSON.stringify(project))).layers[0], styled)
    assert.deepEqual(orientProject(project, 'portrait').layers[0].backgroundColor, '#a13467')
    const disabled = { ...styled, backgroundEnabled: false }
    assert.deepEqual(normalizeProject({ ...raw, layers: [disabled] }).layers[0], disabled)
    const partial = normalizeProject({ ...raw, layers: [{ ...layer, backgroundEnabled: true }] }).layers[0]
    assert.deepEqual([partial.backgroundColor, partial.backgroundOpacity], ['#000000', 1])
    for (const [key, value] of [['backgroundEnabled', 'yes'], ['backgroundEnabled', null],
      ['backgroundColor', 'red'], ['backgroundColor', '#abcdef80'], ['backgroundOpacity', -0.1],
      ['backgroundOpacity', 1.1], ['backgroundOpacity', NaN], ['backgroundOpacity', '0.5']]) {
      assert.throws(() => normalizeProject({ ...raw, layers: [{ ...styled, [key]: value }] }), /background/i)
    }
  }
})

test('saved preview frames survive normalization and older projects default to zero', () => {
  const legacy = defaultProject()
  delete legacy.previewFrame
  assert.equal(normalizeProject(legacy).previewFrame, 0)
  assert.equal(normalizeProject({ ...legacy, previewFrame: 120 }).previewFrame, 120)
  for (const previewFrame of [-1, 1.5, NaN, Infinity, '120', Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => normalizeProject({ ...legacy, previewFrame }), /Invalid preview frame/)
  }
})

test('meter rotation and aspect lock round-trip with legacy defaults', () => {
  const project = { ...defaultProject(), layers: [{ ...spectrumLayer(), rotation: -90, aspectLocked: true }] }
  assert.deepEqual(normalizeProject(project).layers, project.layers)
  const oldLayer = { ...spectrumLayer() }
  delete oldLayer.rotation
  delete oldLayer.aspectLocked
  const loaded = normalizeProject({ ...defaultProject(), layers: [oldLayer] }).layers[0]
  assert.equal(loaded.rotation, 0)
  assert.equal(loaded.aspectLocked, false)
  for (const rotation of [-181, 181, NaN, '90']) {
    assert.throws(() => normalizeProject({ ...project, layers: [{ ...project.layers[0], rotation }] }), /Rotation/)
  }
  assert.throws(() => normalizeProject({ ...project, layers: [{ ...project.layers[0], aspectLocked: 'yes' }] }), /aspect lock/)
})

test('version 2 composition keeps ordered graphics and meter layers with validated settings', () => {
  const project = compositionProject()
  const artwork = { ...imageLayer(), imagePath: 'C:/art/cover.png', fit: 'contain', rotation: -12, opacity: 0.7 }
  const artist = { ...textLayer('artist-1', 'Artist', 'Fixture Artist'), align: 'right', fontFamily: 'Georgia', shadow: 8 }
  project.background = { type: 'gradient', color: '#102030', color2: '#304050', imagePath: '', fit: 'cover' }
  project.layers = [artwork, spectrumLayer(), artist, vectorscopeLayer()]
  assert.deepEqual(normalizeProject(project).layers, project.layers)
  assert.equal(normalizeProject(project).background.type, 'gradient')
  assert.throws(() => normalizeProject({ ...project, layers: [{ ...artwork, imagePath: 'https://example.com/cover.png' }] }), /local PNG/)
  assert.throws(() => normalizeProject({ ...project, layers: [{ ...artist, fontFamily: 'Bad" Font' }] }), /Unsupported font/)
  assert.throws(() => normalizeProject({ ...project, layers: [{ ...artwork, rotation: 181 }] }), /Rotation/)
})

test('two vectorscopes retain independent projection, zoom, band, and correlation settings', () => {
  const first = { ...vectorscopeLayer('scope-a'), x: 40, y: 170, w: 550, h: 450,
    mode: 'polar-bipolar', zoomDb: 6, showCorrelation: true }
  const second = { ...vectorscopeLayer('scope-b'), x: 650, y: 170, w: 550, h: 450,
    mode: 'linear-unipolar', zoomDb: -3, multiband: true, showCorrelation: true,
    bandLowColor: '#ff1111', bandMidColor: '#11ff11', bandHighColor: '#1111ff' }
  const saved = normalizeProject({ ...defaultProject(), layers: [first, second] })
  assert.deepEqual(saved.layers, [first, second])
})

test('old version 1 vectorscope projects gain safe defaults and invalid modes are rejected', () => {
  const legacy = defaultProject()
  for (const key of ['mode', 'zoomDb', 'multiband', 'showGrid', 'showCorrelation',
    'bandLowColor', 'bandMidColor', 'bandHighColor']) delete legacy.layers[0][key]
  assert.deepEqual(normalizeProject(legacy).layers[0], vectorscopeLayer())
  for (const [key, value] of [['mode', 'radial'], ['zoomDb', 3.5], ['multiband', 'yes'],
    ['showGrid', 1], ['showCorrelation', null], ['bandLowColor', 'red']]) {
    const project = defaultProject()
    project.layers[0][key] = value
    assert.throws(() => normalizeProject(project), /vectorscope/i, key)
  }
})

test('two waterfall layers retain independent native history and appearance settings', () => {
  const first = { ...waterfallLayer('waterfall-a'), x: 30, y: 160, w: 580, h: 440 }
  const second = { ...waterfallLayer('waterfall-b'), x: 650, y: 160, w: 580, h: 440,
    fftSize: 4096, scaleMode: 'mel', frequencyRangeMode: 'audible',
    historySeconds: 8, density: 'dense', colorMode: 'heat', smoothing: 0.4, showGrid: false }
  const saved = normalizeProject({ ...defaultProject(), layers: [first, second] })
  assert.deepEqual(saved.layers, [first, second])
})

test('rejects malformed waterfall DSP, history, and display settings', () => {
  const project = { ...defaultProject(), layers: [waterfallLayer()] }
  for (const [key, value] of [['fftSize', 999], ['scaleMode', 'other'], ['frequencyRangeMode', 'other'],
    ['historySeconds', 2.5], ['density', 'other'], ['colorMode', 'other'],
    ['smoothing', 1], ['tiltDbPerOctave', 9], ['showGrid', 'yes']]) {
    project.layers[0] = { ...waterfallLayer(), [key]: value }
    assert.throws(() => normalizeProject(project), /waterfall|Waterfall/i, key)
  }
})

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
  old.version = 3
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

test('encapsulateProjectPath creates dedicated project subfolder without double nesting', () => {
  const path = require('node:path')
  const baseDir = path.resolve('C:/music-projects')
  const result1 = encapsulateProjectPath(path.join(baseDir, 'my-project.json'))
  assert.equal(result1, path.join(baseDir, 'my-project', 'my-project.json'))

  const result2 = encapsulateProjectPath(result1)
  assert.equal(result2, result1)

  const result3 = encapsulateProjectPath(path.join(baseDir, 'song-b'))
  assert.equal(result3, path.join(baseDir, 'song-b', 'song-b.json'))

  const result4 = encapsulateProjectPath(path.join(baseDir, 'song-c.JSON'))
  assert.equal(result4, path.join(baseDir, 'song-c', 'song-c.json'))

  assert.throws(() => encapsulateProjectPath(''), /Invalid target path/)
})

const test = require('node:test')
const assert = require('node:assert/strict')
const { defaultProject, spectrumLayer, normalizeProject } = require('../project.cjs')

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

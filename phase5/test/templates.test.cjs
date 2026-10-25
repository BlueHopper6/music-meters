const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { compositionProject, imageLayer, textLayer, spectrumLayer, normalizeProject } = require('../../phase2/project.cjs')
const { BUILTINS, starter, saveTemplate, readTemplate, listTemplates, duplicateTemplate,
  renameTemplate, applyTemplate, titleSuggestion } = require('../../phase2/templates.cjs')
const { readPreferences, writePreferences } = require('../../phase2/preferences.cjs')

const root = path.resolve(__dirname, '..', '..', 'artifacts', 'phase5')
fs.mkdirSync(root, { recursive: true })

test('three original starter layouts are valid, song-independent, and differently arranged', () => {
  const layouts = BUILTINS.map(starter)
  assert.deepEqual(BUILTINS, ['Minimal Spectrum', 'Studio Dashboard', 'Stereo Showcase'])
  for (const layout of layouts) {
    assert.deepEqual(normalizeProject(layout), layout)
    assert.equal(layout.audioPath, '')
    assert.ok(layout.layers.some(layer => layer.type === 'text' && layer.name === 'Song title' && layer.text === ''))
  }
  assert.equal(new Set(layouts.map(layout => layout.layers.map(layer => layer.type).join(','))).size, 3)
})

test('template lifecycle keeps layout and background asset while clearing song fields', () => {
  const dir = fs.mkdtempSync(path.join(root, 'template-test-'))
  const png = path.join(dir, 'background.png')
  fs.writeFileSync(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==', 'base64'))
  const songA = compositionProject()
  songA.audioPath = 'C:/fixtures/song-A.wav'
  songA.title = 'Song A'
  songA.background = { type: 'image', color: '#111111', color2: '#222222', imagePath: png, fit: 'contain' }
  songA.layers = [
    { ...spectrumLayer('meter'), x: 112, y: 410, w: 900, h: 210, fftSize: 4096, color: '#aabbcc' },
    { ...imageLayer('cover'), imagePath: png },
    { ...textLayer('song-title', 'Song title', 'Song A'), x: 140 },
    { ...textLayer('artist', 'Artist', 'A Singer'), y: 200 },
    { ...textLayer('caption', 'Caption', 'Live session'), y: 290 },
  ]
  const saved = saveTemplate(dir, 'My dashboard', songA)
  const file = path.join(dir, 'templates', `${saved.id}.json`)
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
  assert.equal(raw.kind, 'music-visualizer-template')
  assert.equal(raw.version, 1)
  assert.equal(raw.layout.audioPath, '')
  assert.equal(raw.layout.title, '')
  assert.equal(raw.layout.layers[1].imagePath, '')
  assert.equal(raw.layout.layers[2].text, '')
  assert.equal(raw.layout.layers[3].text, '')
  assert.equal(raw.layout.layers[4].text, '')
  const opened = readTemplate(dir, saved.id)
  assert.ok(fs.existsSync(opened.layout.background.imagePath))
  assert.deepEqual(opened.layout.layers[0], songA.layers[0])
  const songB = { ...songA, audioPath: 'C:/fixtures/song-B.wav', title: 'Song B' }
  const reused = applyTemplate(opened.layout, songB)
  assert.equal(reused.audioPath, songB.audioPath)
  assert.equal(reused.layers[2].text, 'Song B')
  assert.equal(reused.layers[1].imagePath, '')
  assert.deepEqual(reused.layers[0], songA.layers[0])
  const copy = duplicateTemplate(dir, saved.id, 'Second dashboard')
  assert.notEqual(copy.id, saved.id)
  renameTemplate(dir, copy.id, 'Renamed dashboard')
  assert.equal(readTemplate(dir, copy.id).name, 'Renamed dashboard')
  assert.equal(listTemplates(dir).length, 5)
  assert.throws(() => renameTemplate(dir, 'starter:Minimal Spectrum', 'Changed'), /Duplicate/)
  raw.layout.audioPath = '../song-A.wav'
  fs.writeFileSync(file, JSON.stringify(raw))
  assert.throws(() => readTemplate(dir, saved.id), /song media/)
  raw.layout.audioPath = ''
  raw.layout.background.imagePath = '../private.png'
  fs.writeFileSync(file, JSON.stringify(raw))
  assert.throws(() => readTemplate(dir, saved.id), /Invalid project artwork reference/)
  assert.throws(() => readTemplate(dir, '../escape'), /Invalid template ID/)
})

test('local workflow preferences validate presets and title suggestion is editable text', () => {
  const dir = fs.mkdtempSync(path.join(root, 'preferences-test-'))
  assert.deepEqual(readPreferences(dir), { exportPreset: '1080p', lastTemplateId: '' })
  assert.equal(titleSuggestion('C:/music/next_track-demo.wav'), 'next track demo')
  writePreferences(dir, { exportPreset: '720p', lastTemplateId: 'starter:Studio Dashboard' })
  assert.equal(readPreferences(dir).exportPreset, '720p')
  assert.equal(readPreferences(dir).lastTemplateId, 'starter:Studio Dashboard')
  assert.throws(() => writePreferences(dir, { exportPreset: '4k' }), /Unsupported/)
})

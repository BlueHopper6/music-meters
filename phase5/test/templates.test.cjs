const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { compositionProject, imageLayer, textLayer, spectrumLayer, normalizeProject } = require('../../phase2/project.cjs')
const { BUILTINS, starter, saveTemplate, readTemplate, listTemplates, duplicateTemplate,
  renameTemplate, deleteTemplate, applyTemplate, titleSuggestion } = require('../../phase2/templates.cjs')
const { readPreferences, writePreferences, recordRecentProject } = require('../../phase2/preferences.cjs')

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

test('template saving rejects duplicate or starter names unless replacing, auto-names copies, and deletes custom templates', () => {
  const dir = fs.mkdtempSync(path.join(root, 'template-conflict-test-'))
  const pngA = path.join(dir, 'background-a.png')
  fs.writeFileSync(pngA, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==', 'base64'))
  const projectA = compositionProject()
  projectA.background = { type: 'image', color: '#111111', color2: '#222222', imagePath: pngA, fit: 'cover' }
  projectA.layers = [
    { ...spectrumLayer('meter-a'), x: 100, y: 360, w: 920, h: 220, color: '#66ccff' },
  ]
  const first = saveTemplate(dir, 'Template 1', projectA)
  const assetDir = path.join(dir, 'templates', `${first.id}.assets`)
  assert.equal(fs.existsSync(assetDir), true)
  assert.equal(listTemplates(dir).length, 4)

  assert.throws(() => saveTemplate(dir, 'Template 1', projectA), /already exists/)
  assert.throws(() => saveTemplate(dir, 'template 1', projectA), /already exists/)
  assert.throws(() => duplicateTemplate(dir, first.id, 'Template 1'), /already exists/)
  assert.throws(() => saveTemplate(dir, 'Minimal Spectrum', projectA), /built-in starter template/)
  assert.throws(() => saveTemplate(dir, 'studio dashboard', projectA), /built-in starter template/)
  assert.throws(() => saveTemplate(dir, 'Template 1', projectA, 'starter:Minimal Spectrum'), /Built-in starter templates cannot be replaced/)
  assert.throws(() => saveTemplate(dir, 'Template 1', projectA, null), /Invalid template ID/)

  const autoCopy1 = duplicateTemplate(dir, first.id, '')
  assert.equal(autoCopy1.name, 'Template 1 Copy')
  assert.equal(fs.existsSync(path.join(dir, 'templates', `${autoCopy1.id}.assets`)), true)
  const autoCopy2 = duplicateTemplate(dir, first.id)
  assert.equal(autoCopy2.name, 'Template 1 Copy 2')
  const starterCopy = duplicateTemplate(dir, 'starter:Minimal Spectrum', '')
  assert.equal(starterCopy.name, 'Minimal Spectrum Copy')

  assert.throws(() => deleteTemplate(dir, 'starter:Minimal Spectrum'), /Built-in starter templates cannot be deleted/)
  assert.throws(() => deleteTemplate(dir, '../escape'), /Invalid template ID/)
  const deleted1 = deleteTemplate(dir, autoCopy1.id)
  assert.equal(deleted1.id, autoCopy1.id)
  assert.equal(fs.existsSync(path.join(dir, 'templates', `${autoCopy1.id}.json`)), false)
  assert.equal(fs.existsSync(path.join(dir, 'templates', `${autoCopy1.id}.assets`)), false)
  deleteTemplate(dir, autoCopy2.id)
  deleteTemplate(dir, starterCopy.id)
  assert.equal(listTemplates(dir).length, 4)

  const updated = compositionProject()
  updated.background = { type: 'gradient', color: '#101828', color2: '#1f2937', imagePath: '', fit: 'cover' }
  updated.layers = [
    { ...spectrumLayer('meter-a'), x: 240, y: 300, w: 800, h: 260, color: '#ff8844' },
  ]
  const replaced = saveTemplate(dir, 'Template 1', updated, first.id)
  assert.equal(replaced.id, first.id)
  assert.equal(listTemplates(dir).length, 4)
  const reopened = readTemplate(dir, first.id)
  assert.equal(reopened.name, 'Template 1')
  assert.equal(reopened.layout.layers[0].x, 240)
  assert.equal(reopened.layout.layers[0].color, '#ff8844')
  assert.equal(fs.existsSync(assetDir), false)

  const withUnrelatedFile = saveTemplate(dir, 'With unrelated file', projectA)
  const otherAssetDir = path.join(dir, 'templates', `${withUnrelatedFile.id}.assets`)
  const unrelated = path.join(otherAssetDir, 'personal-note.txt')
  fs.writeFileSync(unrelated, 'keep')
  saveTemplate(dir, 'With unrelated file', updated, withUnrelatedFile.id)
  assert.equal(fs.readFileSync(unrelated, 'utf8'), 'keep')
  assert.equal(fs.readdirSync(otherAssetDir).length, 1)

  const second = saveTemplate(dir, 'Template 2', updated)
  assert.throws(() => renameTemplate(dir, second.id, 'Template 1'), /already exists/)
  assert.throws(() => renameTemplate(dir, second.id, 'Stereo Showcase'), /built-in starter template/)
  assert.throws(() => saveTemplate(dir, 'Template 2', updated, first.id), /already exists/)
  assert.throws(() => saveTemplate(dir, 'An unrelated name', updated, first.id), /Replacement name must match/)
  const caseRenamed = renameTemplate(dir, first.id, 'TEMPLATE 1')
  assert.equal(caseRenamed.id, first.id)
  assert.equal(readTemplate(dir, first.id).name, 'TEMPLATE 1')
})

test('local workflow preferences validate presets and title suggestion is editable text', () => {
  const dir = fs.mkdtempSync(path.join(root, 'preferences-test-'))
  assert.deepEqual(readPreferences(dir), { exportPreset: '1080p', lastTemplateId: '', recentProjects: [] })
  assert.equal(titleSuggestion('C:/music/next_track-demo.wav'), 'next track demo')
  writePreferences(dir, { exportPreset: '720p', lastTemplateId: 'starter:Studio Dashboard' })
  assert.equal(readPreferences(dir).exportPreset, '720p')
  assert.equal(readPreferences(dir).lastTemplateId, 'starter:Studio Dashboard')
  assert.throws(() => writePreferences(dir, { exportPreset: '4k' }), /Unsupported/)
  recordRecentProject(dir, 'C:/projects/demo/my-song.json', 'My Song Demo')
  assert.equal(readPreferences(dir).recentProjects.length, 1)
  assert.equal(readPreferences(dir).recentProjects[0].name, 'My Song Demo')
  assert.equal(readPreferences(dir).recentProjects[0].path, path.resolve('C:/projects/demo/my-song.json'))
  recordRecentProject(dir, 'C:/projects/demo/second.json')
  assert.equal(readPreferences(dir).recentProjects.length, 2)
  assert.equal(readPreferences(dir).recentProjects[0].name, 'second')
  recordRecentProject(dir, 'C:/projects/demo/my-song.json', 'My Song Demo Updated')
  assert.equal(readPreferences(dir).recentProjects.length, 2)
  assert.equal(readPreferences(dir).recentProjects[0].name, 'My Song Demo Updated')
})

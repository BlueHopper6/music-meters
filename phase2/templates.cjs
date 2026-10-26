const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { compositionProject, normalizeProject, imageLayer, textLayer, spectrumLayer,
  oscilloscopeLayer, vectorscopeLayer, vuLayer, loudnessLayer, waveformLayer } = require('./project.cjs')
const { saveArtwork, resolveArtwork } = require('./assets.cjs')

const KIND = 'music-visualizer-template'
const BUILTINS = ['Minimal Spectrum', 'Studio Dashboard', 'Stereo Showcase']
const validName = name => typeof name === 'string' && name.trim() === name && name.length > 0
  && name.length <= 80 && !/[\u0000-\u001f]/.test(name)
const validId = id => typeof id === 'string' && /^[0-9a-f-]{36}$/.test(id)
const normalizeNameKey = name => name.trim().toLowerCase()
const templateDir = userData => path.join(userData, 'templates')
const templatePath = (userData, id) => {
  if (!validId(id)) throw new Error('Invalid template ID')
  return path.join(templateDir(userData), `${id}.json`)
}

function findNameConflict(userData, name, ignoreId = '') {
  const key = normalizeNameKey(name)
  return listTemplates(userData).find(entry => entry.id !== ignoreId && normalizeNameKey(entry.name) === key) || null
}

function nextCopyName(userData, baseName) {
  const cleanBase = baseName.replace(/\s+Copy(?:\s+\d+)?$/i, '').trim() || baseName.trim()
  for (let index = 1; index <= 999; index++) {
    const suffix = index === 1 ? ' Copy' : ` Copy ${index}`
    const candidate = `${cleanBase.slice(0, Math.max(1, 80 - suffix.length)).trim()}${suffix}`
    if (!findNameConflict(userData, candidate)) return candidate
  }
  throw new Error('Choose a new template name before duplicating')
}

function pruneTemplateAssets(target, savedLayout) {
  const folder = `${path.basename(target, '.json')}.assets`
  const dir = path.join(path.dirname(target), folder)
  if (!fs.existsSync(dir)) return
  const keep = savedLayout.version === 2 && savedLayout.background.imagePath
    ? path.basename(savedLayout.background.imagePath)
    : ''
  for (const file of fs.readdirSync(dir)) {
    if (file !== keep && /^[a-f0-9]{64}\.(png|jpe?g|webp)$/i.test(file)) {
      fs.rmSync(path.join(dir, file), { force: true })
    }
  }
  if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir)
}

function layoutFromProject(raw) {
  const layout = normalizeProject(raw)
  if (layout.version !== 2) throw new Error('Upgrade this older project to composition graphics before saving a template')
  layout.audioPath = ''
  layout.title = ''
  for (const layer of layout.layers) {
    if (layer.type === 'image') layer.imagePath = ''
    if (layer.type === 'text') layer.text = ''
  }
  return layout
}

function starter(name) {
  if (!BUILTINS.includes(name)) throw new Error('Unknown starter template')
  const layout = compositionProject()
  layout.title = ''
  layout.background = { type: 'gradient', color: '#0e1424', color2: '#273857', imagePath: '', fit: 'cover' }
  if (name === 'Minimal Spectrum') {
    layout.layers = [
      { ...spectrumLayer('minimal-spectrum'), x: 110, y: 370, w: 1060, h: 245, color: '#8ce4ec' },
      { ...textLayer('minimal-title', 'Song title', ''), x: 110, y: 140, w: 1060, h: 100, fontSize: 64, align: 'center' },
      { ...textLayer('minimal-artist', 'Artist', ''), x: 330, y: 250, w: 620, h: 55, fontSize: 32, align: 'center' },
    ]
  } else if (name === 'Studio Dashboard') {
    layout.layers = [
      { ...spectrumLayer('studio-spectrum'), x: 60, y: 480, w: 1160, h: 185 },
      { ...vuLayer('studio-vu'), x: 60, y: 235, w: 215, h: 160, orientation: 'vertical' },
      { ...oscilloscopeLayer('studio-wave'), x: 310, y: 235, w: 610, h: 210 },
      { ...vectorscopeLayer('studio-stereo'), x: 950, y: 235, w: 245, h: 210 },
      { ...imageLayer('studio-art'), x: 60, y: 45, w: 160, h: 160, visible: false },
      { ...textLayer('studio-title', 'Song title', ''), x: 250, y: 63, w: 900, h: 78 },
      { ...textLayer('studio-artist', 'Artist', ''), x: 252, y: 145, w: 800, h: 48, fontSize: 28 },
    ]
  } else {
    layout.layers = [
      { ...waveformLayer('stereo-waveform'), x: 80, y: 455, w: 1120, h: 180 },
      { ...vectorscopeLayer('stereo-scope'), x: 380, y: 205, w: 520, h: 230, mode: 'polar-bipolar', showCorrelation: true },
      { ...loudnessLayer('stereo-loudness'), x: 925, y: 220, w: 265, h: 195 },
      { ...textLayer('stereo-title', 'Song title', ''), x: 80, y: 65, w: 1120, h: 82, align: 'center' },
      { ...textLayer('stereo-artist', 'Artist', ''), x: 350, y: 150, w: 580, h: 48, fontSize: 28, align: 'center' },
    ]
  }
  return normalizeProject(layout)
}

function readTemplate(userData, id) {
  if (id.startsWith('starter:')) return { id, name: id.slice(8), layout: starter(id.slice(8)) }
  const target = templatePath(userData, id)
  if (fs.statSync(target).size > 1024 * 1024) throw new Error('Template file is too large')
  const stored = JSON.parse(fs.readFileSync(target, 'utf8'))
  if (stored.kind !== KIND || stored.version !== 1 || stored.id !== id || !validName(stored.name)) {
    throw new Error('Invalid template file')
  }
  const layout = normalizeProject(resolveArtwork(stored.layout, target))
  if (layout.version !== 2 || layout.audioPath || layout.title || layout.layers.some(layer =>
    layer.type === 'image' && layer.imagePath || layer.type === 'text' && layer.text)) {
    throw new Error('Template contains song media or metadata')
  }
  return { id, name: stored.name, layout }
}

function listTemplates(userData) {
  const entries = BUILTINS.map(name => ({ id: `starter:${name}`, name, builtIn: true }))
  if (!fs.existsSync(templateDir(userData))) return entries
  for (const file of fs.readdirSync(templateDir(userData))) {
    const id = path.basename(file, '.json')
    if (!file.endsWith('.json') || !validId(id)) continue
    try { const item = readTemplate(userData, id); entries.push({ id, name: item.name, builtIn: false }) }
    catch { /* Malformed local files are skipped; direct load still reports their error. */ }
  }
  return entries
}

function saveTemplate(userData, name, raw, overwriteId = '') {
  if (!validName(name)) throw new Error('Template name must be 1–80 characters')
  if (typeof overwriteId !== 'string') throw new Error('Invalid template ID')
  if (overwriteId.startsWith('starter:')) throw new Error('Built-in starter templates cannot be replaced')
  const conflict = findNameConflict(userData, name, overwriteId)
  if (conflict?.builtIn) throw new Error(`"${conflict.name}" is a built-in starter template. Choose a different name.`)
  if (conflict) throw new Error(`Template "${conflict.name}" already exists. Replace it or choose a different name.`)
  if (overwriteId) {
    const previous = readTemplate(userData, overwriteId)
    if (normalizeNameKey(previous.name) !== normalizeNameKey(name)) {
      throw new Error('Replacement name must match the existing template')
    }
  }
  const id = overwriteId || randomUUID()
  const target = templatePath(userData, id)
  const layout = layoutFromProject(raw)
  const savedLayout = saveArtwork(layout, target)
  const stored = { kind: KIND, version: 1, id, name, layout: savedLayout }
  fs.mkdirSync(templateDir(userData), { recursive: true })
  const json = JSON.stringify(stored, null, 2) + '\n'
  if (overwriteId) {
    const temporary = path.join(templateDir(userData), `.${id}.${randomUUID()}.tmp`)
    try {
      fs.writeFileSync(temporary, json, { flag: 'wx' })
      fs.renameSync(temporary, target)
    } finally {
      if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true })
    }
  } else {
    fs.writeFileSync(target, json, { flag: 'wx' })
  }
  if (overwriteId) pruneTemplateAssets(target, savedLayout)
  return { id, name, builtIn: false }
}

function duplicateTemplate(userData, id, name = '') {
  const source = readTemplate(userData, id)
  const targetName = typeof name === 'string' && name.trim() === '' ? nextCopyName(userData, source.name) : name
  return saveTemplate(userData, targetName, source.layout)
}

function renameTemplate(userData, id, name) {
  if (!validName(name)) throw new Error('Template name must be 1–80 characters')
  const current = readTemplate(userData, id)
  if (id.startsWith('starter:')) throw new Error('Duplicate a starter template before renaming it')
  const conflict = findNameConflict(userData, name, id)
  if (conflict?.builtIn) throw new Error(`"${conflict.name}" is a built-in starter template. Choose a different name.`)
  if (conflict) throw new Error(`Template "${conflict.name}" already exists. Choose a different name.`)
  const target = templatePath(userData, id)
  const stored = { kind: KIND, version: 1, id, name, layout: saveArtwork(current.layout, target) }
  fs.writeFileSync(target, JSON.stringify(stored, null, 2) + '\n')
  return { id, name, builtIn: false }
}

function deleteTemplate(userData, id) {
  if (typeof id === 'string' && id.startsWith('starter:')) {
    throw new Error('Built-in starter templates cannot be deleted')
  }
  const current = readTemplate(userData, id)
  const target = templatePath(userData, id)
  const assetsDir = path.join(templateDir(userData), `${id}.assets`)
  fs.rmSync(target, { force: true })
  fs.rmSync(assetsDir, { recursive: true, force: true })
  return { id: current.id, name: current.name }
}

function applyTemplate(layout, current) {
  const validated = normalizeProject(layout)
  const song = normalizeProject(current)
  if (validated.version !== 2 || validated.audioPath) throw new Error('Template is not song-independent')
  for (const layer of validated.layers) if (layer.type === 'text' && /^song title$/i.test(layer.name)) {
    layer.text = song.title === 'Untitled track' && song.audioPath ? titleSuggestion(song.audioPath) : song.title
  }
  return normalizeProject({ ...validated, audioPath: song.audioPath, title: song.title })
}

function titleSuggestion(audioPath) {
  return path.basename(audioPath, path.extname(audioPath)).replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200) || 'Untitled track'
}

module.exports = { BUILTINS, layoutFromProject, starter, readTemplate, listTemplates,
  saveTemplate, duplicateTemplate, renameTemplate, deleteTemplate, nextCopyName, applyTemplate, titleSuggestion }

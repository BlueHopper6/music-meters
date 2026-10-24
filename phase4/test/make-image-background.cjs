const fs = require('node:fs')
const path = require('node:path')
const { normalizeProject } = require('../../phase2/project.cjs')
const { resolveArtwork, saveArtwork } = require('../../phase2/assets.cjs')

const source = path.resolve(process.argv[2])
const target = path.resolve(process.argv[3])
const stored = JSON.parse(fs.readFileSync(source, 'utf8'))
const loaded = normalizeProject(resolveArtwork({ ...stored, audioPath: path.resolve(path.dirname(source), stored.audioRelativePath) }, source))
const artwork = loaded.layers.find(layer => layer.type === 'image')
if (!artwork) throw new Error('Source project needs artwork')
loaded.background = { ...loaded.background, type: 'image', imagePath: artwork.imagePath, fit: 'cover' }
const document = { ...saveArtwork(normalizeProject(loaded), target), audioPath: undefined,
  audioRelativePath: path.relative(path.dirname(target), loaded.audioPath).replaceAll('\\', '/') }
fs.writeFileSync(target, JSON.stringify(document, null, 2) + '\n', { flag: 'wx' })
console.log(target)

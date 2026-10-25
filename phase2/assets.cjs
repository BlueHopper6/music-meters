const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }

function readImage(input) {
  if (typeof input !== 'string' || !path.isAbsolute(input) || input.startsWith('\\\\')) throw new Error('Artwork path must be local and absolute')
  const extension = path.extname(input).toLowerCase()
  const mime = MIME[extension]
  if (!mime) throw new Error('Artwork must be PNG, JPEG, or WebP')
  const stat = fs.statSync(input)
  if (!stat.isFile() || stat.size === 0 || stat.size > 8 * 1024 * 1024) throw new Error('Artwork must be a nonempty file under 8 MB')
  const bytes = fs.readFileSync(input)
  const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
  const webp = bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
  if (!(mime === 'image/png' && png || mime === 'image/jpeg' && jpeg || mime === 'image/webp' && webp)) throw new Error('Artwork file content does not match its extension')
  return { bytes, mime, extension }
}

function imagePaths(project) {
  const paths = new Set()
  if (project.version === 2) {
    if (project.background.type === 'image' && project.background.imagePath) paths.add(project.background.imagePath)
    for (const layer of project.layers) if (layer.type === 'image' && layer.imagePath) paths.add(layer.imagePath)
  }
  return [...paths]
}

function assetData(project, requireComplete = true) {
  if (project.version === 2 && requireComplete) {
    if (project.background.type === 'image' && !project.background.imagePath) throw new Error('Choose a background image')
    if (project.layers.some(layer => layer.type === 'image' && layer.visible && !layer.imagePath)) throw new Error('Choose artwork for each visible image layer')
  }
  const data = {}
  let totalBytes = 0
  for (const input of imagePaths(project)) {
    if (!requireComplete && !fs.existsSync(input)) continue
    const { bytes, mime } = readImage(input)
    totalBytes += bytes.length
    if (totalBytes > 24 * 1024 * 1024) throw new Error('Project artwork exceeds 24 MB in total')
    data[input] = `data:${mime};base64,${bytes.toString('base64')}`
  }
  return data
}

function saveArtwork(project, target) {
  if (project.version !== 2) return project
  const copied = structuredClone(project)
  const folder = `${path.basename(target, '.json')}.assets`
  const dir = path.join(path.dirname(target), folder)
  const replace = input => {
    if (!input) return ''
    const { bytes, extension } = readImage(input)
    const name = `${createHash('sha256').update(bytes).digest('hex')}${extension}`
    fs.mkdirSync(dir, { recursive: true })
    const destination = path.join(dir, name)
    if (!fs.existsSync(destination)) fs.writeFileSync(destination, bytes, { flag: 'wx' })
    return `${folder}/${name}`
  }
  copied.background.imagePath = replace(copied.background.imagePath)
  for (const layer of copied.layers) if (layer.type === 'image') layer.imagePath = replace(layer.imagePath)
  return copied
}

function resolveArtwork(project, target) {
  if (project.version !== 2) return project
  const folder = `${path.basename(target, '.json')}.assets`
  const resolveRef = ref => {
    if (!ref) return ''
    if (typeof ref !== 'string' || !ref.startsWith(`${folder}/`) || ref.includes('\\')
        || !/^[a-f0-9]{64}\.(png|jpe?g|webp)$/i.test(ref.slice(folder.length + 1))) {
      throw new Error('Invalid project artwork reference')
    }
    return path.join(path.dirname(target), folder, ref.slice(folder.length + 1))
  }
  const resolved = structuredClone(project)
  resolved.background.imagePath = resolveRef(resolved.background.imagePath)
  for (const layer of resolved.layers) if (layer.type === 'image') layer.imagePath = resolveRef(layer.imagePath)
  return resolved
}

module.exports = { readImage, imagePaths, assetData, saveArtwork, resolveArtwork }

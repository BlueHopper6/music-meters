const fs = require('node:fs')
const path = require('node:path')
const { createHash, randomUUID } = require('node:crypto')
const { normalizeProject } = require('./project.cjs')
const { imagePaths, readImage, resolveArtwork } = require('./assets.cjs')
const { projectSaveName } = require('./project-path.cjs')
const { resolveProjectAudio, projectAudioReference } = require('./project-audio.cjs')
const OWNED_MEDIA = '.musicmeters-owned-media'

const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const samePath = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()

function assertLocal(input) {
  if (typeof input !== 'string' || !path.isAbsolute(input) || input.startsWith('\\\\')) throw new Error('Choose a local absolute path')
  let current = path.resolve(input)
  for (;;) {
    try {
      if (fs.lstatSync(current).isSymbolicLink()) throw new Error('Project operations do not follow links or junctions')
    } catch (error) { if (error.code !== 'ENOENT') throw error }
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
}

function within(root, file) {
  const relative = path.relative(root, file)
  if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error('File is outside its project folder')
  assertLocal(root); assertLocal(file)
}

function readLibraryProject(source) {
  assertLocal(source)
  const stat = fs.statSync(source)
  if (!stat.isFile() || stat.size > 1024 * 1024 || path.extname(source).toLowerCase() !== '.json') throw new Error('Choose a valid project JSON file under 1 MB')
  const bytes = fs.readFileSync(source)
  const stored = JSON.parse(bytes)
  const audioPath = resolveProjectAudio(source, stored.audioRelativePath)
  const project = normalizeProject(resolveArtwork({ ...stored, audioPath }, source))
  return { source, bytes, stored, project }
}

function assertUnchanged(file, bytes) {
  assertLocal(file)
  if (!fs.statSync(file).isFile() || digest(fs.readFileSync(file)) !== digest(bytes)) throw new Error('Project changed on disk. Refresh and try again.')
}

function writeAtomic(file, bytes) {
  const temporary = file + '.update-' + randomUUID() + '.tmp'
  try {
    within(path.dirname(file), temporary)
    fs.writeFileSync(temporary, bytes, { flag: 'wx' })
    assertLocal(file); fs.renameSync(temporary, file)
  } finally {
    if (fs.existsSync(temporary)) { within(path.dirname(file), temporary); fs.unlinkSync(temporary) }
  }
}

function inspectTree(root, limit = { files: 0 }) {
  assertLocal(root)
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (++limit.files > 10000) throw new Error('Project folder has too many files to rename safely')
    const file = path.join(root, entry.name)
    within(root, file)
    if (entry.isDirectory()) inspectTree(file, limit)
    else if (!entry.isFile()) throw new Error('Project folder contains an unsupported file')
  }
}

function renameLibraryProject(source, title) {
  if (typeof title !== 'string' || !title.trim() || title.trim().length > 200 || /[\u0000-\u001f]/.test(title)) throw new Error('Project name must be 1–200 characters')
  const snapshot = readLibraryProject(source)
  const root = path.dirname(source), oldStem = path.basename(source, '.json')
  if (path.dirname(root) === root || path.basename(root).toLowerCase() !== oldStem.toLowerCase()) throw new Error('Use Move to… to put this project in its own named folder before renaming it')
  inspectTree(root)
  const filename = projectSaveName(title), stem = path.basename(filename, '.json')
  const destination = path.join(path.dirname(root), stem)
  const target = path.join(destination, filename)
  assertLocal(destination)
  if (!samePath(root, destination) && fs.existsSync(destination)) throw new Error('A project folder with that name already exists')
  if (filename !== path.basename(source) && fs.existsSync(path.join(root, filename)) && !samePath(path.join(root, filename), source)) throw new Error('A project file with that name already exists')
  const oldAssets = oldStem + '.assets', newAssets = stem + '.assets'
  if (oldAssets !== newAssets && !samePath(path.join(root, oldAssets), path.join(root, newAssets)) && fs.existsSync(path.join(root, newAssets))) throw new Error('An artwork folder with that name already exists')
  const next = structuredClone(snapshot.stored)
  next.title = title.trim()
  if (next.version === 2) {
    const rewrite = ref => ref ? newAssets + '/' + ref.slice(oldAssets.length + 1) : ''
    next.background.imagePath = rewrite(next.background.imagePath)
    for (const layer of next.layers) if (layer.type === 'image') layer.imagePath = rewrite(layer.imagePath)
  }
  const audio = snapshot.project.audioPath
  const relativeAudio = audio ? path.relative(root, audio) : ''
  const audioInside = audio && relativeAudio !== '..' && !relativeAudio.startsWith('..' + path.sep) && !path.isAbsolute(relativeAudio)
  next.audioRelativePath = projectAudioReference(target, audioInside ? path.join(destination, relativeAudio) : audio)
  const manifestPath = path.join(root, OWNED_MEDIA)
  const manifest = fs.existsSync(manifestPath) ? readOwnedMedia(snapshot) : null
  const manifestBytes = manifest ? fs.readFileSync(manifestPath) : null
  const temporary = path.join(path.dirname(root), '.musicmeters-rename-' + randomUUID())
  assertLocal(temporary)
  if (fs.existsSync(temporary)) throw new Error('Rename staging folder already exists')
  let currentRoot = root, fileRenamed = false, assetsRenamed = false
  try {
    assertUnchanged(source, snapshot.bytes)
    fs.renameSync(root, temporary); currentRoot = temporary
    if (fs.existsSync(path.join(temporary, oldAssets)) && oldAssets !== newAssets) {
      fs.renameSync(path.join(temporary, oldAssets), path.join(temporary, newAssets)); assetsRenamed = true
    }
    if (path.basename(source) !== filename) { fs.renameSync(path.join(temporary, path.basename(source)), path.join(temporary, filename)); fileRenamed = true }
    writeAtomic(path.join(temporary, filename), JSON.stringify(next, null, 2) + '\n')
    if (manifest) writeAtomic(path.join(temporary, OWNED_MEDIA), JSON.stringify({ ...manifest, project: filename }, null, 2) + '\n')
    fs.renameSync(temporary, destination); currentRoot = destination
  } catch (error) {
    if (currentRoot === temporary) {
      try {
        if (fileRenamed) fs.renameSync(path.join(temporary, filename), path.join(temporary, path.basename(source)))
        if (assetsRenamed) fs.renameSync(path.join(temporary, newAssets), path.join(temporary, oldAssets))
        writeAtomic(path.join(temporary, path.basename(source)), snapshot.bytes)
        if (manifestBytes) writeAtomic(path.join(temporary, OWNED_MEDIA), manifestBytes)
        if (fs.existsSync(root)) throw new Error('Original folder was recreated elsewhere')
        fs.renameSync(temporary, root)
      } catch (rollback) { throw new Error(`Rename could not be restored automatically. Project files are preserved at ${temporary}. ${rollback.message}`) }
    }
    throw error
  }
  return { path: target, name: next.title }
}

function readOwnedMedia(snapshot) {
  const root = path.dirname(snapshot.source), file = path.join(root, OWNED_MEDIA)
  assertLocal(file)
  if (fs.statSync(file).size > 65536) throw new Error('Invalid copied-media record')
  const value = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (value.version !== 1 || value.project !== path.basename(snapshot.source) || !Array.isArray(value.files) || value.files.length > 128) throw new Error('Invalid copied-media record')
  for (const entry of value.files) {
    if (!entry || typeof entry.path !== 'string' || !/^audio\/[^/\\<>:"|?*\u0000-\u001f]+\.(wav|mp3|flac)$/i.test(entry.path) || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error('Invalid copied-media reference')
    within(root, path.join(root, entry.path))
  }
  return value
}

async function fileDigest(file) {
  assertLocal(file)
  const hash = createHash('sha256')
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}

function removeCreated(root, files, directories) {
  for (const file of files.reverse()) {
    within(root, file)
    try { fs.unlinkSync(file) } catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  for (const dir of directories.reverse()) {
    within(root, dir)
    try { fs.rmdirSync(dir) } catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  assertLocal(root)
  fs.rmdirSync(root)
}

async function copyLibraryProject(source, target, title, onCopied = () => {}) {
  const snapshot = readLibraryProject(source)
  if (typeof title !== 'string' || !title.trim() || title.length > 200) throw new Error('Invalid project name')
  assertLocal(target)
  const root = path.dirname(target)
  if (samePath(source, target) || fs.existsSync(root)) throw new Error('Destination project folder already exists. Choose a new name or location.')
  if (path.extname(target).toLowerCase() !== '.json') throw new Error('Project file must end in .json')
  assertLocal(path.dirname(root))
  const originals = [{ path: source, bytes: snapshot.bytes }]
  const artwork = new Map()
  const references = new Set(imagePaths(snapshot.project))
  if (snapshot.project.version === 2 && snapshot.project.background.imagePath) references.add(snapshot.project.background.imagePath)
  let artworkBytes = 0
  let bytesNeeded = BigInt(snapshot.bytes.length)
  for (const input of references) {
    within(path.dirname(source), input)
    const image = readImage(input)
    bytesNeeded += BigInt(image.bytes.length)
    artworkBytes += image.bytes.length
    if (artworkBytes > 24 * 1024 * 1024) throw new Error('Project artwork exceeds 24 MB')
    artwork.set(input, image)
    originals.push({ path: input, bytes: image.bytes })
  }
  const audio = snapshot.project.audioPath
  const space = fs.statfsSync(path.dirname(root), { bigint: true })
  if (space.bavail * space.bsize < bytesNeeded + 8n * 1024n * 1024n) throw new Error('Not enough free space at the destination')
  const files = [], directories = []
  fs.mkdirSync(root) // Exclusive claim: never merge into an existing folder.
  try {
    const next = structuredClone(snapshot.project)
    next.title = title.trim()
    const assets = path.basename(target, path.extname(target)) + '.assets'
    const rewritten = new Map()
    for (const [input, image] of artwork) {
      const dir = path.join(root, assets)
      if (!directories.includes(dir)) { within(root, dir); fs.mkdirSync(dir); directories.push(dir) }
      const filename = digest(image.bytes) + image.extension
      const destination = path.join(dir, filename)
      if (!files.includes(destination)) {
        within(root, destination); fs.writeFileSync(destination, image.bytes, { flag: 'wx' }); files.push(destination)
        if (digest(fs.readFileSync(destination)) !== digest(image.bytes)) throw new Error('Artwork copy verification failed')
      }
      rewritten.set(input, assets + '/' + filename)
    }
    if (next.version === 2) {
      next.background.imagePath = rewritten.get(next.background.imagePath) || ''
      for (const layer of next.layers) if (layer.type === 'image') layer.imagePath = rewritten.get(layer.imagePath) || ''
    }
    const document = { ...next, audioPath: undefined, audioRelativePath: projectAudioReference(target, audio) }
    within(root, target); fs.writeFileSync(target, JSON.stringify(document, null, 2) + '\n', { flag: 'wx' }); files.push(target)
    const reopened = readLibraryProject(target)
    if (reopened.project.title !== title.trim()) throw new Error('Project copy verification failed')
    for (const original of originals) assertUnchanged(original.path, original.bytes)
  } catch (error) {
    try { removeCreated(root, files, directories) }
    catch { throw new Error(`Copy failed; partial files remain at ${root}. Original project was kept. ${error.message}`) }
    throw error
  }
  // Register the verified destination before any source removal is attempted.
  try { await onCopied({ path: target, name: title.trim() }) }
  catch (error) { throw new Error(`Project copied to ${target}, but its recent-project entry could not be updated. Original was kept. ${error.message}`) }
  return { path: target, name: title.trim(), originals, source }
}

function removeOriginalProject(copy) {
  const root = path.dirname(copy.source)
  for (const original of copy.originals) { within(root, original.path); assertUnchanged(original.path, original.bytes) }
  const removed = []
  try {
    for (const original of [...copy.originals].reverse()) {
      within(root, original.path); fs.unlinkSync(original.path); removed.push(original)
    }
  } catch (error) {
    for (const original of removed.reverse()) {
      within(root, original.path)
      if (fs.existsSync(original.path)) assertUnchanged(original.path, original.bytes)
      else fs.writeFileSync(original.path, original.bytes, { flag: 'wx' })
    }
    throw new Error(`The project was copied to ${copy.path}, but the original could not be removed and was restored. ${error.message}`)
  }
  const assets = path.join(root, path.basename(copy.source, '.json') + '.assets')
  if (fs.existsSync(assets)) {
    within(root, assets)
    if (fs.readdirSync(assets).length === 0) {
      try { fs.rmdirSync(assets) } catch (error) { if (!['ENOENT', 'ENOTEMPTY', 'EACCES', 'EPERM', 'EBUSY'].includes(error.code)) throw error }
    }
  }
  // Only remove an empty app-created project folder, never a general parent.
  if (path.dirname(root) !== root && path.basename(copy.source, '.json') && path.basename(root).toLowerCase() === path.basename(copy.source, '.json').toLowerCase()) {
    assertLocal(root)
    if (fs.readdirSync(root).length === 0) {
      try { fs.rmdirSync(root) } catch (error) { if (!['ENOENT', 'ENOTEMPTY', 'EACCES', 'EPERM', 'EBUSY'].includes(error.code)) throw error }
    }
  }
}

async function deleteLibraryProject(source, trash) {
  const snapshot = readLibraryProject(source), root = path.dirname(source)
  const files = new Set([source])
  const assets = path.join(root, path.basename(source, '.json') + '.assets')
  if (fs.existsSync(assets)) {
    within(root, assets)
    for (const entry of fs.readdirSync(assets, { withFileTypes: true })) {
      if (/^[a-f0-9]{64}\.(png|jpe?g|webp)$/i.test(entry.name)) {
        const file = path.join(assets, entry.name); within(root, file)
        if (!entry.isFile()) throw new Error('Copied artwork is not a regular file')
        files.add(file)
      }
    }
  }
  const manifestPath = path.join(root, OWNED_MEDIA)
  if (fs.existsSync(manifestPath)) {
    const manifest = readOwnedMedia(snapshot)
    files.add(manifestPath)
    for (const entry of manifest.files) {
      const file = path.join(root, entry.path)
      if (fs.existsSync(file)) { within(root, file); if (!fs.statSync(file).isFile()) throw new Error('Copied media is not a regular file'); files.add(file) }
    }
  }
  const fingerprints = new Map()
  for (const file of files) { within(root, file); fingerprints.set(file, await fileDigest(file)) }
  if (fingerprints.get(source) !== digest(snapshot.bytes)) throw new Error('Project changed on disk. Nothing was deleted.')
  const staging = path.join(path.dirname(root), '.musicmeters-delete-' + randomUUID())
  assertLocal(staging); fs.mkdirSync(staging)
  const payload = path.join(staging, path.basename(root)); within(staging, payload); fs.mkdirSync(payload)
  const moved = [], createdDirs = new Set([payload])
  function createParent(parent) {
    if (fs.existsSync(parent)) return
    createParent(path.dirname(parent)); within(staging, parent); fs.mkdirSync(parent); createdDirs.add(parent)
  }
  try {
    for (const file of files) {
      if (await fileDigest(file) !== fingerprints.get(file)) throw new Error('Project changed on disk. Nothing was deleted.')
      const destination = path.join(payload, path.relative(root, file))
      within(staging, destination); createParent(path.dirname(destination))
      fs.renameSync(file, destination); moved.push({ file, destination })
    }
    const stagedProject = path.join(payload, path.basename(source))
    const next = { ...snapshot.stored }
    const audioOwned = files.has(snapshot.project.audioPath)
    if (snapshot.project.audioPath && !audioOwned) next.audioRelativePath = projectAudioReference(stagedProject, snapshot.project.audioPath)
    writeAtomic(stagedProject, JSON.stringify(next, null, 2) + '\n')
    inspectTree(staging)
    await trash(staging)
    if (fs.existsSync(staging)) throw new Error('Recycle Bin did not accept the project')
  } catch (error) {
    try {
      const stagedProject = path.join(payload, path.basename(source))
      if (fs.existsSync(stagedProject)) writeAtomic(stagedProject, snapshot.bytes)
      for (const entry of moved.reverse()) {
        within(root, entry.file); within(staging, entry.destination)
        if (fs.existsSync(entry.file)) throw new Error('An original path was recreated during deletion')
        fs.renameSync(entry.destination, entry.file)
      }
      for (const dir of [...createdDirs].sort((a, b) => b.length - a.length)) { within(staging, dir); fs.rmdirSync(dir) }
      assertLocal(staging); fs.rmdirSync(staging)
    } catch (rollback) { throw new Error(`Delete could not be restored automatically. Remaining project files are preserved at ${staging}. ${rollback.message}`) }
    throw error
  }
  for (const dir of [assets, path.join(root, 'audio')]) {
    try { if (fs.existsSync(dir)) { within(root, dir); if (fs.statSync(dir).isDirectory() && fs.readdirSync(dir).length === 0) fs.rmdirSync(dir) } } catch { /* Keep any folder that cannot safely be removed. */ }
  }
  try {
    if (path.dirname(root) !== root && path.basename(root).toLowerCase() === path.basename(source, '.json').toLowerCase() && fs.readdirSync(root).length === 0) { assertLocal(root); fs.rmdirSync(root) }
  } catch { /* The project is recycled; leave remaining parent folders alone. */ }
  return { path: source, name: snapshot.project.title }
}

module.exports = { readLibraryProject, renameLibraryProject, copyLibraryProject, removeOriginalProject, deleteLibraryProject }

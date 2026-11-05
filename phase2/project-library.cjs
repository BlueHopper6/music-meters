const fs = require('node:fs')
const path = require('node:path')
const { createHash, randomUUID } = require('node:crypto')
const { normalizeProject } = require('./project.cjs')
const { imagePaths, readImage, resolveArtwork, saveArtwork } = require('./assets.cjs')
const { prepareStoredMedia, renameLocal } = require('./media-storage.cjs')
const { projectSaveName } = require('./project-path.cjs')
const { resolveProjectAudio, projectAudioReference } = require('./project-audio.cjs')
const { saveVideoReferences, resolveVideoReferences } = require('./project-media.cjs')
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
  const project = normalizeProject(resolveVideoReferences(resolveArtwork({ ...stored, audioPath }, source), source))
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
    assertLocal(file); renameLocal(temporary, file)
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
  const movedReference = original => {
    const relative = path.relative(root, original)
    if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) return original
    return path.join(destination, relative.startsWith(oldAssets + path.sep) ? newAssets + relative.slice(oldAssets.length) : relative)
  }
  if (next.version === 2) {
    const rewrite = (ref, storage) => !ref ? '' : storage === 'link'
      ? projectAudioReference(target, movedReference(resolveProjectAudio(source, ref))) : newAssets + '/' + ref.slice(oldAssets.length + 1)
    next.background.imagePath = rewrite(next.background.imagePath, next.background.storage)
    for (const layer of next.layers) if (layer.type === 'image') layer.imagePath = rewrite(layer.imagePath, layer.storage)
  }
  const audio = snapshot.project.audioPath
  const relativeAudio = audio ? path.relative(root, audio) : ''
  const audioInside = audio && relativeAudio !== '..' && !relativeAudio.startsWith('..' + path.sep) && !path.isAbsolute(relativeAudio)
  const movedRelative = relative => relative.startsWith(oldAssets + path.sep) ? newAssets + relative.slice(oldAssets.length) : relative
  next.audioRelativePath = projectAudioReference(target, audioInside ? path.join(destination, movedRelative(relativeAudio)) : audio)
  for (const layer of next.layers) if (layer.type === 'video') {
    const original = snapshot.project.layers.find(item => item.id === layer.id).videoPath
    const relative = original ? path.relative(root, original) : ''
    const inside = original && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)
    layer.videoRelativePath = projectAudioReference(target, inside ? path.join(destination, movedRelative(relative)) : original)
  }
  const manifestPath = path.join(root, OWNED_MEDIA)
  const manifest = fs.existsSync(manifestPath) ? readOwnedMedia(snapshot) : null
  const manifestBytes = manifest ? fs.readFileSync(manifestPath) : null
  const temporary = path.join(path.dirname(root), '.musicmeters-rename-' + randomUUID())
  assertLocal(temporary)
  if (fs.existsSync(temporary)) throw new Error('Rename staging folder already exists')
  let currentRoot = root, fileRenamed = false, assetsRenamed = false
  try {
    assertUnchanged(source, snapshot.bytes)
    renameLocal(root, temporary); currentRoot = temporary
    if (fs.existsSync(path.join(temporary, oldAssets)) && oldAssets !== newAssets) {
      renameLocal(path.join(temporary, oldAssets), path.join(temporary, newAssets)); assetsRenamed = true
    }
    if (path.basename(source) !== filename) { renameLocal(path.join(temporary, path.basename(source)), path.join(temporary, filename)); fileRenamed = true }
    writeAtomic(path.join(temporary, filename), JSON.stringify(next, null, 2) + '\n')
    if (manifest) writeAtomic(path.join(temporary, OWNED_MEDIA), JSON.stringify({ ...manifest, project: filename }, null, 2) + '\n')
    renameLocal(temporary, destination); currentRoot = destination
  } catch (error) {
    if (currentRoot === temporary) {
      try {
        if (fileRenamed) renameLocal(path.join(temporary, filename), path.join(temporary, path.basename(source)))
        if (assetsRenamed) renameLocal(path.join(temporary, newAssets), path.join(temporary, oldAssets))
        writeAtomic(path.join(temporary, path.basename(source)), snapshot.bytes)
        if (manifestBytes) writeAtomic(path.join(temporary, OWNED_MEDIA), manifestBytes)
        if (fs.existsSync(root)) throw new Error('Original folder was recreated elsewhere')
        renameLocal(temporary, root)
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
  const stream = fs.createReadStream(file)
  try { for await (const chunk of stream) hash.update(chunk) }
  finally {
    stream.destroy()
    if (!stream.closed) await new Promise(resolve => stream.once('close', resolve))
  }
  return hash.digest('hex')
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
  const linked = new Set()
  if (snapshot.project.audioStorage !== 'copy') linked.add(snapshot.project.audioPath)
  if (snapshot.project.version === 2) {
    if (snapshot.project.background.storage === 'link') linked.add(snapshot.project.background.imagePath)
    for (const layer of snapshot.project.layers) {
      if (layer.type==='image' && layer.storage==='link') linked.add(layer.imagePath)
      if (layer.type==='video' && layer.storage!=='copy') linked.add(layer.videoPath)
    }
  }
  let bytesNeeded = BigInt(snapshot.bytes.length)
  const artworkReferences = new Set(imagePaths(snapshot.project))
  if (snapshot.project.version === 2 && snapshot.project.background.imagePath) artworkReferences.add(snapshot.project.background.imagePath)
  for (const input of artworkReferences) if (!linked.has(input)) bytesNeeded += BigInt(readImage(input).bytes.length)
  const space = fs.statfsSync(path.dirname(root), { bigint:true })
  if (space.bavail * space.bsize < bytesNeeded + 8n * 1024n * 1024n) throw new Error('Not enough free space at the destination')

  fs.mkdirSync(root) // Exclusive claim: never merge into an existing folder.
  try {
    const next = await prepareStoredMedia(snapshot.project, target)
    next.title = title.trim()
    const artwork = saveArtwork(next, target, false)
    const document = { ...saveVideoReferences(artwork, target), audioPath: undefined,
      audioRelativePath: projectAudioReference(target, next.audioPath) }
    within(root,target); fs.writeFileSync(target, JSON.stringify(document,null,2)+'\n',{flag:'wx'})
    const reopened = readLibraryProject(target)
    if (reopened.project.title !== title.trim()) throw new Error('Project copy verification failed')
    const originalAssets = path.join(path.dirname(source),path.basename(source,'.json')+'.assets')
    const collect = async (input, copied) => {
      if (linked.has(input)) return
      if (!input || path.dirname(input) !== originalAssets || !/^[a-f0-9]{64}\.[a-z0-9]+$/i.test(path.basename(input))) return
      within(path.dirname(source),input)
      const hash = await fileDigest(input)
      if (hash !== path.basename(input).slice(0,64)) throw new Error('Owned project media changed; original kept')
      if (!originals.some(x=>x.path===input)) originals.push({path:input,hash,backup:copied})
    }
    const originalImages = imagePaths(snapshot.project), copiedImages = imagePaths(reopened.project)
    for (let i=0;i<originalImages.length;i++) {
      const original = originalImages[i]
      if (copiedImages[i] !== original) await collect(original,copiedImages[i])
    }
    if (snapshot.project.audioStorage === 'copy') await collect(snapshot.project.audioPath,reopened.project.audioPath)
    for (const layer of snapshot.project.layers) if (layer.type==='video' && layer.storage==='copy') await collect(layer.videoPath,reopened.project.layers.find(x=>x.id===layer.id).videoPath)
    assertUnchanged(source,snapshot.bytes)
  } catch (error) {
    // Preserve any incomplete copy for inspection; never risk an original or
    // unrelated file by recursively cleaning a failed save/copy.
    throw new Error('Copy failed; partial files remain at '+root+'. Original project was kept. '+error.message)
  }
  // Register the verified destination before any source removal is attempted.
  try { await onCopied({ path: target, name: title.trim() }) }
  catch (error) { throw new Error(`Project copied to ${target}, but its recent-project entry could not be updated. Original was kept. ${error.message}`) }
  return { path: target, name: title.trim(), originals, source }
}

function mediaDigestSync(file) {
  assertLocal(file)
  const fd=fs.openSync(file,'r'), hash=createHash('sha256'), buffer=Buffer.alloc(1024*1024)
  try { for (;;) { const size=fs.readSync(fd,buffer,0,buffer.length,null); if(!size)break; hash.update(buffer.subarray(0,size)) } return hash.digest('hex') }
  finally {fs.closeSync(fd)}
}
function checkOriginal(original) {
  if (original.bytes) assertUnchanged(original.path,original.bytes)
  else if (mediaDigestSync(original.path)!==original.hash || mediaDigestSync(original.backup)!==original.hash) throw new Error('Project media changed. Original was kept.')
}
function removeOriginalProject(copy) {
  const root = path.dirname(copy.source)
  for (const original of copy.originals) { within(root, original.path); checkOriginal(original) }
  const removed = []
  try {
    for (const original of [...copy.originals].reverse()) {
      within(root, original.path); fs.unlinkSync(original.path); removed.push(original)
    }
  } catch (error) {
    for (const original of removed.reverse()) {
      within(root, original.path)
      if (fs.existsSync(original.path)) checkOriginal(original)
      else if (original.bytes) fs.writeFileSync(original.path, original.bytes, { flag: 'wx' }); else fs.copyFileSync(original.backup,original.path,fs.constants.COPYFILE_EXCL)
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
  const owned = new Set()
  if (snapshot.project.audioStorage === 'copy') owned.add(snapshot.project.audioPath)
  if (snapshot.project.version === 2) {
    if (snapshot.project.background.storage !== 'link') owned.add(snapshot.project.background.imagePath)
    for (const layer of snapshot.project.layers) {
      if (layer.type === 'image' && layer.storage !== 'link') owned.add(layer.imagePath)
      if (layer.type === 'video' && layer.storage === 'copy') owned.add(layer.videoPath)
    }
  }
  if (snapshot.project.audioStorage !== 'copy') owned.delete(snapshot.project.audioPath)
  if (snapshot.project.version === 2) {
    if (snapshot.project.background.storage==='link') owned.delete(snapshot.project.background.imagePath)
    for (const layer of snapshot.project.layers) {
      if (layer.type==='image' && layer.storage==='link') owned.delete(layer.imagePath)
      if (layer.type==='video' && layer.storage!=='copy') owned.delete(layer.videoPath)
    }
  }
  if (fs.existsSync(assets)) {
    within(root, assets)
    for (const entry of fs.readdirSync(assets, { withFileTypes: true })) {
      if (/^[a-f0-9]{64}\.(png|jpe?g|webp|wav|mp3|flac|mp4|mov|mkv|webm|avi|m4v)$/i.test(entry.name) && owned.has(path.join(assets,entry.name))) {
        const file = path.join(assets, entry.name); within(root, file)
        if (!entry.isFile()) throw new Error('Copied artwork is not a regular file')
        if (await fileDigest(file) === entry.name.slice(0,64)) files.add(file)
      }
    }
  }
  const manifestPath = path.join(root, OWNED_MEDIA)
  if (fs.existsSync(manifestPath)) {
    const manifest = readOwnedMedia(snapshot)
    files.add(manifestPath)
    for (const entry of manifest.files) {
      const file = path.join(root, entry.path)
      if (fs.existsSync(file)) { within(root, file); if (!fs.statSync(file).isFile()) throw new Error('Copied media is not a regular file'); if (file === snapshot.project.audioPath && await fileDigest(file) === entry.sha256) files.add(file) }
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
      renameLocal(file, destination); moved.push({ file, destination })
    }
    const stagedProject = path.join(payload, path.basename(source))
    const next = { ...snapshot.stored }
    const stagedLayers = saveVideoReferences(snapshot.project, stagedProject).layers
    next.layers = next.layers.map(layer => layer.type === 'video' && !files.has(snapshot.project.layers.find(item=>item.id===layer.id).videoPath) ? stagedLayers.find(item => item.id === layer.id) : layer)
    if (next.version === 2) {
      if (snapshot.project.background.imagePath && !files.has(snapshot.project.background.imagePath)) {
        next.background.storage = 'link'; next.background.imagePath = projectAudioReference(stagedProject,snapshot.project.background.imagePath)
      }
      for (const layer of next.layers) if (layer.type==='image') {
        const original = snapshot.project.layers.find(item=>item.id===layer.id).imagePath
        if (original && !files.has(original)) { layer.storage='link'; layer.imagePath=projectAudioReference(stagedProject,original) }
      }
    }
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
        renameLocal(entry.destination, entry.file)
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

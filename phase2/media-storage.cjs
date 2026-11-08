const fs = require('node:fs')
const path = require('node:path')
const { createHash, randomUUID } = require('node:crypto')
const { isForeignPlatformReference } = require('./project-audio.cjs')

function isDarwinRootSystemSymlink(targetPath, platform = process.platform) {
  return platform === 'darwin' && (targetPath === '/var' || targetPath === '/tmp' || targetPath === '/etc')
}

function samePath(a, b) {
  const resolvedA = path.resolve(a)
  const resolvedB = path.resolve(b)
  if (resolvedA === resolvedB) return true
  if (resolvedA.toLowerCase() !== resolvedB.toLowerCase()) return false
  let statA, statB
  try { statA = fs.statSync(resolvedA, { bigint: true }) } catch { statA = null }
  try { statB = fs.statSync(resolvedB, { bigint: true }) } catch { statB = null }
  if (statA && statB) return statA.dev === statB.dev && statA.ino === statB.ino
  if (statA || statB) return false
  return true
}

function assertLocal(input, options = {}) {
  const platform = options.platform || process.platform
  const pathMod = platform === 'win32' ? path.win32 : platform === 'darwin' ? path.posix : path
  if (typeof input !== 'string' || !pathMod.isAbsolute(input) || input.startsWith('\\\\')) throw new Error('Choose a local absolute path')
  for (let current = pathMod.resolve(input);;) {
    try {
      if (!isDarwinRootSystemSymlink(current, platform) && fs.lstatSync(current).isSymbolicLink()) {
        throw new Error('Media storage does not follow links or junctions')
      }
    } catch (error) { if (error.code !== 'ENOENT') throw error }
    const parent = pathMod.dirname(current)
    if (parent === current) break
    current = parent
  }
}
function ensureDirectory(dir) { assertLocal(dir); fs.mkdirSync(dir, { recursive:true }); assertLocal(dir) }
function renameLocal(source, target) {
  for (let attempt=0;;attempt++) {
    assertLocal(source); assertLocal(target)
    try { fs.renameSync(source,target); return }
    catch (error) {
      if (process.platform!=='win32' || !['EPERM','EACCES','EBUSY'].includes(error.code) || attempt===7) throw error
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,25*(attempt+1))
    }
  }
}
async function fileDigest(file) {
  assertLocal(file)
  const hash = createHash('sha256')
  const stream = fs.createReadStream(file)
  try { for await (const bytes of stream) hash.update(bytes) }
  finally {
    stream.destroy()
    if (!stream.closed) await new Promise(resolve => stream.once('close', resolve))
  }
  return hash.digest('hex')
}
function writeAtomic(file, bytes) {
  ensureDirectory(path.dirname(file)); assertLocal(file)
  const temporary = file + '.save-' + randomUUID() + '.tmp'
  let fd
  try {
    fd = fs.openSync(temporary, 'wx'); fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined
    renameLocal(temporary, file)
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
    if (fs.existsSync(temporary)) { assertLocal(temporary); fs.unlinkSync(temporary) }
  }
}
async function copyMedia(input, target) {
  assertLocal(input); assertLocal(target)
  if (!fs.statSync(input).isFile()) throw new Error('Media source is not a file')
  const hash = await fileDigest(input), folder = path.basename(target, '.json') + '.assets'
  const dir = path.join(path.dirname(target), folder)
  ensureDirectory(dir)
  const destination = path.join(dir, hash + path.extname(input).toLowerCase())
  assertLocal(destination)
  if (!fs.existsSync(destination)) {
    const volume = fs.statfsSync(dir, { bigint:true })
    const required = fs.statSync(input, { bigint:true }).size + 8n * 1024n * 1024n
    if (volume.bavail * volume.bsize < required) throw new Error('Not enough free space to copy media into the project')
    const temporary = destination + '.copy-' + randomUUID() + '.tmp'
    try {
      await fs.promises.copyFile(input, temporary, fs.constants.COPYFILE_EXCL)
      if (await fileDigest(temporary) !== hash) throw new Error('Media changed while copying; original kept')
      // Exclusive publication, including if another save created this hash.
      try { await fs.promises.link(temporary, destination) }
      catch (error) {
        if (error.code !== 'EEXIST') {
          if (!['EPERM','EACCES','ENOTSUP','EOPNOTSUPP','EINVAL','EXDEV'].includes(error.code)) throw error
          const free = fs.statfsSync(dir, { bigint:true })
          if (free.bavail * free.bsize < required) throw new Error('Not enough temporary space to finish the verified copy on this drive')
          try { await fs.promises.copyFile(temporary, destination, fs.constants.COPYFILE_EXCL) }
          catch (copyError) { if (copyError.code !== 'EEXIST') throw copyError }
        }
      }
    } finally { if (fs.existsSync(temporary)) { assertLocal(temporary); fs.unlinkSync(temporary) } }
  }
  if (await fileDigest(destination) !== hash) throw new Error('Existing project media does not match its content hash')
  return destination
}
async function prepareStoredMedia(project, target) {
  const copied = structuredClone(project)
  if (copied.audioPath && copied.audioStorage === 'copy' && !isForeignPlatformReference(copied.audioPath)) {
    copied.audioName ??= path.basename(copied.audioPath)
    copied.audioPath = await copyMedia(copied.audioPath, target)
  }
  for (const layer of copied.layers) if (layer.type === 'video' && layer.videoPath && layer.storage === 'copy' && !isForeignPlatformReference(layer.videoPath)) {
    layer.sourceName ??= path.basename(layer.videoPath)
    layer.videoPath = await copyMedia(layer.videoPath, target)
  }
  return copied
}
module.exports = { isDarwinRootSystemSymlink, samePath, assertLocal, ensureDirectory, renameLocal, fileDigest, writeAtomic, copyMedia, prepareStoredMedia }

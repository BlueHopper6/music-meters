const fs = require('node:fs')
const path = require('node:path')
const { createHash, randomUUID } = require('node:crypto')
const { assertLocal } = require('./media-storage.cjs')
const hash = value => createHash('sha256').update(value).digest('hex')

function projectVersion(file) {
  const info = fs.statSync(file)
  if (!info.isFile() || info.size > 1024 * 1024) throw new Error('Invalid project for thumbnail')
  return hash(fs.readFileSync(file))
}
function validateThumbnail(data) {
  if (typeof data !== 'string' || data.length > 1024 * 1024 || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(data)) throw new Error('Invalid project thumbnail')
  const bytes = Buffer.from(data.slice(22), 'base64')
  if (bytes.length < 33 || !bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
      || bytes.toString('ascii',12,16) !== 'IHDR' || bytes.readUInt32BE(8) !== 13
      || bytes.readUInt32BE(16) < 1 || bytes.readUInt32BE(20) < 1
      || bytes.readUInt32BE(16) > 320 || bytes.readUInt32BE(20) > 320) throw new Error('Invalid project thumbnail dimensions')
  return data
}
function cachePath(userData, file) {
  const root = path.resolve(userData, 'project-thumbnails')
  try {
    assertLocal(root)
  } catch {
    throw new Error('Unsafe thumbnail cache')
  }
  if (fs.existsSync(root) && fs.lstatSync(root).isSymbolicLink()) throw new Error('Unsafe thumbnail cache')
  return path.join(root, hash(path.resolve(file).toLowerCase()).slice(0,32) + '.json')
}
function readThumbnail(userData, file, version = projectVersion(file)) {
  try {
    const target = cachePath(userData,file), stat = fs.lstatSync(target)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1100000) return null
    const cached = JSON.parse(fs.readFileSync(target,'utf8'))
    return cached.version === version ? validateThumbnail(cached.png) : null
  } catch { return null }
}
function writeThumbnail(userData, file, version, png) {
  validateThumbnail(png)
  if (typeof version !== 'string' || !/^[a-f0-9]{64}$/.test(version) || projectVersion(file) !== version) return false
  const target = cachePath(userData,file)
  fs.mkdirSync(path.dirname(target),{recursive:true})
  if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) throw new Error('Unsafe thumbnail cache entry')
  const temporary = target + '.' + randomUUID() + '.tmp'
  try { fs.writeFileSync(temporary,JSON.stringify({version,png}),{flag:'wx'}); fs.renameSync(temporary,target) }
  finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary) }
  return true
}
module.exports = { projectVersion, validateThumbnail, readThumbnail, writeThumbnail }

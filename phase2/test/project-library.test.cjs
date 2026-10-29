const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { randomUUID, createHash } = require('node:crypto')
const { compositionProject, defaultProject, imageLayer } = require('../project.cjs')
const { saveArtwork, imagePaths } = require('../assets.cjs')
const { readLibraryProject, renameLibraryProject, copyLibraryProject, removeOriginalProject, deleteLibraryProject } = require('../project-library.cjs')

const root = path.resolve(__dirname, '../../artifacts/phase2/project-library-' + randomUUID())
fs.mkdirSync(root, { recursive: true })
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=', 'base64')

function fixture(version = 2) {
  const dir = path.join(root, randomUUID())
  const folder = path.join(dir, 'Original')
  fs.mkdirSync(folder, { recursive: true })
  const audio = path.join(dir, 'song.wav')
  const wav = Buffer.alloc(44 + 1920)
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8)
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22)
  wav.writeUInt32LE(48000, 24); wav.writeUInt32LE(192000, 28); wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34)
  wav.write('data', 36); wav.writeUInt32LE(1920, 40)
  fs.writeFileSync(audio, wav)
  const image = path.join(dir, 'art.png'); fs.writeFileSync(image, png)
  const source = path.join(folder, 'Original.json')
  const project = { ...(version === 2 ? compositionProject() : defaultProject()), title: 'Original project', audioPath: audio }
  if (version === 2) {
    project.background.imagePath = image // Retain an image choice even while the background is solid.
    project.layers.push({ ...imageLayer('cover'), imagePath: image })
  }
  const document = { ...saveArtwork(project, source), audioPath: undefined, audioRelativePath: '../song.wav' }
  fs.writeFileSync(source, JSON.stringify(document, null, 2))
  return { dir, source, audio, target: path.join(dir, 'Copied', 'Copied.json') }
}

test('rename changes title, folder, JSON and artwork references while preserving media and extra files', () => {
  const f = fixture(), originalHash = hash(f.audio)
  fs.writeFileSync(path.join(path.dirname(f.source), 'notes.txt'), 'Keep me')
  const renamed = renameLibraryProject(f.source, '  New project name  ')
  assert.equal(renamed.path, path.join(f.dir, 'New project name', 'New project name.json'))
  assert.equal(fs.existsSync(path.dirname(f.source)), false)
  const after = readLibraryProject(renamed.path)
  assert.equal(after.project.title, 'New project name')
  assert.equal(after.project.audioPath, f.audio)
  for (const image of imagePaths(after.project)) assert.ok(fs.existsSync(image))
  assert.ok(after.stored.background.imagePath.startsWith('New project name.assets/'))
  assert.equal(fs.readFileSync(path.join(path.dirname(renamed.path), 'notes.txt'), 'utf8'), 'Keep me')
  assert.equal(hash(f.audio), originalHash)
  assert.throws(() => renameLibraryProject(renamed.path, ' '), /1–200/)
  assert.throws(() => renameLibraryProject(renamed.path, 'bad\nname'), /1–200/)
  const again = renameLibraryProject(renamed.path, 'new project name')
  assert.equal(path.basename(again.path), 'new project name.json')
  assert.equal(readLibraryProject(again.path).project.title, 'new project name')
})

test('rename refuses collisions and restores all original bytes if the final folder move fails', () => {
  const f = fixture(), before = hash(f.source)
  fs.mkdirSync(path.join(f.dir, 'Existing'))
  assert.throws(() => renameLibraryProject(f.source, 'Existing'), /already exists/)
  const rename = fs.renameSync
  fs.renameSync = (from, to) => {
    if (to === path.join(f.dir, 'Failed')) throw new Error('Injected move failure')
    return rename(from, to)
  }
  try { assert.throws(() => renameLibraryProject(f.source, 'Failed'), /Injected move failure/) }
  finally { fs.renameSync = rename }
  assert.equal(hash(f.source), before)
  for (const image of imagePaths(readLibraryProject(f.source).project)) assert.ok(fs.existsSync(image))
  assert.equal(fs.readdirSync(f.dir).some(name => name.startsWith('.musicmeters-rename-')), false)
})

test('copy includes byte-identical audio/artwork and portable relative references without modifying originals', async () => {
  const f = fixture()
  const before = hash(f.source)
  let registered = false
  const copy = await copyLibraryProject(f.source, f.target, 'Copied project', () => { registered = true })
  assert.ok(registered)
  const opened = readLibraryProject(copy.path)
  assert.equal(opened.project.title, 'Copied project')
  assert.equal(hash(opened.project.audioPath), hash(f.audio))
  assert.ok(opened.project.audioPath.startsWith(path.dirname(f.target) + path.sep))
  for (const image of imagePaths(opened.project)) assert.equal(hash(image), createHash('sha256').update(png).digest('hex'))
  assert.ok(opened.project.background.imagePath, 'Inactive background image choice must be retained')
  assert.equal(hash(f.source), before)
  await assert.rejects(copyLibraryProject(f.source, f.target, 'Collision'), /already exists/)
  assert.equal(hash(f.source), before)
})

test('move removes only verified project-owned originals and keeps audio and unrelated files', async () => {
  const f = fixture()
  const note = path.join(path.dirname(f.source), 'notes.txt'); fs.writeFileSync(note, 'Keep this note')
  const copy = await copyLibraryProject(f.source, f.target, 'Moved project')
  removeOriginalProject(copy)
  assert.equal(fs.existsSync(f.source), false)
  assert.equal(fs.readFileSync(note, 'utf8'), 'Keep this note')
  assert.ok(fs.existsSync(f.audio))
  assert.equal(readLibraryProject(f.target).project.title, 'Moved project')
})

test('projects without audio can be copied and moved, removing only their empty managed folder', async () => {
  const f = fixture()
  const document = JSON.parse(fs.readFileSync(f.source, 'utf8'))
  document.audioRelativePath = ''
  fs.writeFileSync(f.source, JSON.stringify(document))
  const copy = await copyLibraryProject(f.source, f.target, 'No audio')
  assert.equal(readLibraryProject(f.target).project.audioPath, '')
  removeOriginalProject(copy)
  assert.equal(fs.existsSync(path.dirname(f.source)), false)
  assert.ok(fs.existsSync(f.dir))
  assert.ok(fs.existsSync(f.audio))
  assert.equal(readLibraryProject(f.target).project.title, 'No audio')
})

test('source changes after verification prevent deletion and preserve both projects', async () => {
  const f = fixture()
  const copy = await copyLibraryProject(f.source, f.target, 'Copy')
  const renamed = renameLibraryProject(f.source, 'Edited elsewhere')
  assert.throws(() => removeOriginalProject(copy), /ENOENT|changed on disk/)
  assert.equal(readLibraryProject(renamed.path).project.title, 'Edited elsewhere')
  assert.equal(readLibraryProject(f.target).project.title, 'Copy')
})

test('missing media leaves originals unchanged and does not create a destination', async () => {
  const f = fixture()
  const stored = JSON.parse(fs.readFileSync(f.source, 'utf8'))
  stored.audioRelativePath = '../missing.wav'
  fs.writeFileSync(f.source, JSON.stringify(stored))
  const before = hash(f.source)
  await assert.rejects(copyLibraryProject(f.source, f.target, 'Copy'), /ENOENT/)
  assert.equal(hash(f.source), before)
  assert.equal(fs.existsSync(path.dirname(f.target)), false)
  const renamed = renameLibraryProject(f.source, 'Still renameable')
  assert.equal(readLibraryProject(renamed.path).project.title, 'Still renameable')
})

test('failed audio verification removes only files created by this copy', async () => {
  const f = fixture()
  const copyFile = fs.promises.copyFile
  fs.promises.copyFile = async (_source, target) => fs.writeFileSync(target, 'corrupted')
  try { await assert.rejects(copyLibraryProject(f.source, f.target, 'Copy'), /verification failed/) }
  finally { fs.promises.copyFile = copyFile }
  assert.ok(fs.existsSync(f.source))
  assert.equal(fs.existsSync(path.dirname(f.target)), false)
})

test('insufficient destination space is rejected before any project files are created', async () => {
  const f = fixture()
  const before = hash(f.source)
  const statfs = fs.statfsSync
  fs.statfsSync = () => ({ bavail: 0n, bsize: 4096n })
  try { await assert.rejects(copyLibraryProject(f.source, f.target, 'Copy'), /Not enough free space/) }
  finally { fs.statfsSync = statfs }
  assert.equal(hash(f.source), before)
  assert.equal(fs.existsSync(path.dirname(f.target)), false)
})

test('failed original removal restores deleted artwork and keeps the verified destination', async () => {
  const f = fixture()
  const copy = await copyLibraryProject(f.source, f.target, 'Copy')
  const unlink = fs.unlinkSync
  fs.unlinkSync = file => {
    if (file === f.source) throw Object.assign(new Error('Locked source'), { code: 'EACCES' })
    return unlink(file)
  }
  try { assert.throws(() => removeOriginalProject(copy), /original could not be removed and was restored/) }
  finally { fs.unlinkSync = unlink }
  for (const image of imagePaths(readLibraryProject(f.source).project)) assert.ok(fs.existsSync(image))
  assert.equal(readLibraryProject(f.target).project.title, 'Copy')
})

test('failed preference registration keeps the source and reports the completed copy location', async () => {
  const f = fixture(1)
  await assert.rejects(copyLibraryProject(f.source, f.target, 'Copy', () => { throw new Error('Preferences locked') }), /Project copied to.*Original was kept/)
  assert.ok(fs.existsSync(f.source))
  assert.equal(readLibraryProject(f.target).project.version, 1)
})

test('linked project parents and destinations are rejected before writes', async t => {
  const f = fixture()
  const alias = path.join(f.dir, 'linked')
  try { fs.symlinkSync(path.dirname(f.source), alias, process.platform === 'win32' ? 'junction' : 'dir') }
  catch (error) { if (['EPERM', 'EACCES'].includes(error.code)) return t.skip('Host does not permit link creation'); throw error }
  assert.throws(() => renameLibraryProject(path.join(alias, 'Original.json'), 'Blocked'), /links or junctions/)
  await assert.rejects(copyLibraryProject(f.source, path.join(alias, 'Copy', 'Copy.json'), 'Blocked'), /links or junctions/)
  assert.equal(readLibraryProject(f.source).project.title, 'Original project')
})

async function recycleInFixture(f, source) {
  const bin = path.join(f.dir, 'fake-bin-' + randomUUID())
  await deleteLibraryProject(source, async staging => fs.renameSync(staging, bin))
  return bin
}

test('delete recycles copied audio and artwork, preserving original media and unrelated files', async () => {
  const f = fixture(), audioHash = hash(f.audio), sourceHash = hash(f.source)
  await copyLibraryProject(f.source, f.target, 'Copy')
  const renamed = renameLibraryProject(f.target, 'Renamed copy')
  const copy = readLibraryProject(renamed.path)
  assert.equal(JSON.parse(fs.readFileSync(path.join(path.dirname(renamed.path), '.musicmeters-owned-media'))).project, 'Renamed copy.json')
  const note = path.join(path.dirname(renamed.path), 'notes.txt'); fs.writeFileSync(note, 'Keep this')
  const bin = await recycleInFixture(f, renamed.path)
  assert.equal(fs.existsSync(renamed.path), false)
  assert.equal(fs.existsSync(copy.project.audioPath), false)
  for (const image of imagePaths(copy.project)) assert.equal(fs.existsSync(image), false)
  assert.equal(fs.readFileSync(note, 'utf8'), 'Keep this')
  assert.equal(hash(f.audio), audioHash)
  assert.equal(hash(f.source), sourceHash)
  const recovered = readLibraryProject(path.join(bin, 'Renamed copy', 'Renamed copy.json'))
  assert.equal(hash(recovered.project.audioPath), audioHash)
  for (const image of imagePaths(recovered.project)) assert.ok(fs.existsSync(image))
})

test('delete keeps unrecorded internal audio and external originals, including in a recoverable project', async () => {
  const f = fixture()
  const root = path.dirname(f.source), local = path.join(root, 'original.wav')
  fs.copyFileSync(f.audio, local)
  const stored = JSON.parse(fs.readFileSync(f.source)); stored.audioRelativePath = 'original.wav'
  fs.writeFileSync(f.source, JSON.stringify(stored))
  const bin = await recycleInFixture(f, f.source)
  assert.ok(fs.existsSync(local)); assert.ok(fs.existsSync(f.audio))
  assert.equal(readLibraryProject(path.join(bin, 'Original', 'Original.json')).project.audioPath, local)
})

test('failed recycling restores the project and every copied media file byte for byte', async () => {
  const f = fixture()
  await copyLibraryProject(f.source, f.target, 'Copy')
  const before = readLibraryProject(f.target), original = hash(f.target)
  await assert.rejects(deleteLibraryProject(f.target, async () => { throw new Error('Recycle unavailable') }), /Recycle unavailable/)
  assert.equal(hash(f.target), original)
  assert.equal(hash(before.project.audioPath), hash(f.audio))
  for (const image of imagePaths(before.project)) assert.ok(fs.existsSync(image))
  assert.equal(fs.readdirSync(f.dir).some(name => name.startsWith('.musicmeters-delete-')), false)
})

test('forged ownership paths and linked copied media are rejected without deleting anything', async t => {
  const f = fixture()
  await copyLibraryProject(f.source, f.target, 'Copy')
  const record = path.join(path.dirname(f.target), '.musicmeters-owned-media')
  const value = JSON.parse(fs.readFileSync(record)); const valid = JSON.stringify(value)
  value.files[0].path = '../song.wav'; fs.writeFileSync(record, JSON.stringify(value))
  await assert.rejects(deleteLibraryProject(f.target, async () => assert.fail('Must not recycle')), /Invalid copied-media reference/)
  assert.ok(fs.existsSync(f.target)); assert.ok(fs.existsSync(f.audio))
  fs.writeFileSync(record, valid)
  const alias = path.join(path.dirname(f.target), 'linked')
  try { fs.symlinkSync(f.dir, alias, process.platform === 'win32' ? 'junction' : 'dir') }
  catch (error) { if (['EPERM', 'EACCES'].includes(error.code)) return t.skip('Host does not permit link creation'); throw error }
  assert.throws(() => renameLibraryProject(f.target, 'Blocked'), /links or junctions/)
  await assert.rejects(deleteLibraryProject(path.join(alias, 'Copied', 'Copied.json'), async () => assert.fail('Must not recycle')), /links or junctions/)
  assert.ok(fs.existsSync(f.target)); assert.ok(fs.existsSync(f.audio))
})

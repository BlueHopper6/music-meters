const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path')
const { randomUUID, createHash } = require('node:crypto')
const { compositionProject, imageLayer, videoLayer, normalizeProject } = require('../project.cjs')
const { saveArtwork } = require('../assets.cjs')
const { saveVideoReferences } = require('../project-media.cjs')
const { projectAudioReference } = require('../project-audio.cjs')
const { prepareStoredMedia, copyMedia, writeAtomic } = require('../media-storage.cjs')
const { readLibraryProject, copyLibraryProject, renameLibraryProject, deleteLibraryProject, removeOriginalProject } = require('../project-library.cjs')
const root=path.resolve('artifacts/phase2/media-storage-'+randomUUID()); fs.mkdirSync(root,{recursive:true})
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex')
function fixture(storage) {
  const dir=path.join(root,randomUUID());fs.mkdirSync(dir)
  const audio=path.join(dir,'song.wav'),video=path.join(dir,'clip.mp4'),image=path.join(dir,'art.png')
  fs.writeFileSync(audio,'original audio');fs.writeFileSync(video,'original video')
  fs.writeFileSync(image,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=','base64'))
  const project=normalizeProject({...compositionProject(),audioPath:audio,audioStorage:storage,layers:[{...imageLayer('art'),imagePath:image,storage},{...videoLayer('video'),videoPath:video,storage}]})
  return {dir,audio,video,image,project,target:path.join(dir,'Project','Project.json')}
}
async function save(project,target) {
  const prepared=await prepareStoredMedia(project,target)
  const stored={...saveVideoReferences(saveArtwork(prepared,target,false),target),audioPath:undefined,audioRelativePath:projectAudioReference(target,prepared.audioPath)}
  writeAtomic(target,JSON.stringify(stored));return readLibraryProject(target).project
}
test('copy saves original bytes, reuses verified files and carries media through Save As, rename, copy and move',async()=>{
  const f=fixture('copy'),saved=await save(f.project,f.target)
  for (const [original,copied] of [[f.audio,saved.audioPath],[f.video,saved.layers[1].videoPath],[f.image,saved.layers[0].imagePath]]) {assert.notEqual(original,copied);assert.equal(hash(original),hash(copied))}
  const savedHash=hash(saved.audioPath);fs.appendFileSync(f.audio,'changed original');assert.equal(hash(saved.audioPath),savedHash,'project copy must be independent of the source file')
  assert.deepEqual(await save(saved,f.target),saved)
  const target=path.join(f.dir,'Other','Other.json'),other=await save(saved,target)
  assert.notEqual(saved.audioPath,other.audioPath);assert.equal(hash(saved.audioPath),hash(other.audioPath))
  const renamed=renameLibraryProject(f.target,'Renamed'),after=readLibraryProject(renamed.path).project
  for(const file of [after.audioPath,after.layers[1].videoPath,after.layers[0].imagePath])assert.ok(fs.existsSync(file))
  const copy=await copyLibraryProject(renamed.path,path.join(f.dir,'Moved','Moved.json'),'Moved')
  removeOriginalProject(copy)
  assert.equal(fs.existsSync(renamed.path),false)
  assert.ok(fs.existsSync(readLibraryProject(copy.path).project.audioPath))
  for(const file of [f.audio,f.video,f.image])assert.ok(fs.existsSync(file))
})
test('linked originals survive Save As, library copy, move, delete and recovery without duplication',async()=>{
  const f=fixture('link'),saved=await save(f.project,f.target)
  assert.equal(saved.audioPath,f.audio);assert.equal(saved.layers[0].imagePath,f.image);assert.equal(saved.layers[1].videoPath,f.video)
  assert.equal(fs.existsSync(path.join(path.dirname(f.target),'Project.assets')),false)
  const copied=await copyLibraryProject(f.target,path.join(f.dir,'Linked','Linked.json'),'Linked')
  const next=readLibraryProject(copied.path).project;assert.equal(next.layers[0].imagePath,f.image)
  removeOriginalProject(copied)
  const bin=path.join(f.dir,'bin')
  await deleteLibraryProject(copied.path,async staging=>fs.renameSync(staging,bin))
  const recovered=readLibraryProject(path.join(bin,'Linked','Linked.json')).project
  assert.equal(recovered.audioPath,f.audio);assert.equal(recovered.layers[0].imagePath,f.image);assert.equal(recovered.layers[1].videoPath,f.video)
  for(const file of [f.audio,f.video,f.image])assert.ok(fs.existsSync(file))
})
test('deletion recycles owned copies and preserves modified copied files',async()=>{
  const f=fixture('copy'),saved=await save(f.project,f.target)
  fs.writeFileSync(saved.audioPath,'user replacement')
  const bin=path.join(f.dir,'bin')
  await deleteLibraryProject(f.target,async staging=>fs.renameSync(staging,bin))
  assert.equal(fs.readFileSync(saved.audioPath,'utf8'),'user replacement')
  assert.equal(fs.existsSync(saved.layers[1].videoPath),false)
  assert.ok(fs.existsSync(readLibraryProject(path.join(bin,'Project','Project.json')).project.layers[1].videoPath))
  for(const file of [f.audio,f.video,f.image])assert.ok(fs.existsSync(file))
})
test('existing copied media with mismatched hash is never overwritten',async()=>{
  const f=fixture('copy'),destination=await copyMedia(f.audio,f.target)
  fs.writeFileSync(destination,'replacement')
  await assert.rejects(copyMedia(f.audio,f.target),/content hash/)
  assert.equal(fs.readFileSync(destination,'utf8'),'replacement')
})
test('failed atomic save keeps the previous project file',()=>{
  const file=path.join(root,'atomic.json');writeAtomic(file,'old')
  const write=fs.writeFileSync
  fs.writeFileSync=(fd,...args)=>{if(typeof fd==='number'){write(fd,'partial');throw new Error('ENOSPC injected')}return write(fd,...args)}
  try{assert.throws(()=>writeAtomic(file,'new'),/ENOSPC/)}finally{fs.writeFileSync=write}
  assert.equal(fs.readFileSync(file,'utf8'),'old')
})
test('storage refuses source and destination junctions before copying',async()=>{
  const f=fixture('copy'),alias=path.join(root,'alias-'+randomUUID())
  fs.symlinkSync(f.dir,alias,process.platform==='win32'?'junction':'dir')
  await assert.rejects(copyMedia(path.join(alias,'song.wav'),f.target),/links or junctions/)
  await assert.rejects(copyMedia(f.audio,path.join(alias,'target','project.json')),/links or junctions/)
  assert.equal(fs.existsSync(path.dirname(f.target)),false)
})
test('an explicit link protects a file also used by a copied artwork layer',async()=>{
  const f=fixture('copy'),saved=await save(f.project,f.target)
  saved.layers.push({...saved.layers[0],id:'linked-art',storage:'link'})
  const current=await save(saved,f.target),original=current.layers[0].imagePath
  const copied=await copyLibraryProject(f.target,path.join(f.dir,'Duplicate','Duplicate.json'),'Duplicate')
  removeOriginalProject(copied)
  assert.ok(fs.existsSync(original),'move must retain the explicitly linked original')
  const project=readLibraryProject(copied.path).project
  assert.equal(project.layers[2].imagePath,original)
  await deleteLibraryProject(copied.path,async staging=>fs.renameSync(staging,path.join(f.dir,'bin')))
  assert.ok(fs.existsSync(original))
})

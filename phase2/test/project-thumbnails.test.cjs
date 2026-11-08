const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path')
const {projectVersion,validateThumbnail,readThumbnail,writeThumbnail}=require('../project-thumbnails.cjs')
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jf2kAAAAASUVORK5CYII='
test('thumbnail cache is versioned, bounded and never changes the project',()=>{
  const root=path.resolve('artifacts/phase2');fs.mkdirSync(root,{recursive:true})
  const dir=fs.mkdtempSync(path.join(root,'project-thumbnail-')),file=path.join(dir,'project.json'),profile=path.join(dir,'profile')
  fs.writeFileSync(file,'{"title":"Before"}')
  const version=projectVersion(file),original=fs.readFileSync(file)
  assert.equal(readThumbnail(profile,file),null)
  assert.equal(writeThumbnail(profile,file,version,png),true)
  assert.equal(readThumbnail(profile,file),png);assert.deepEqual(fs.readFileSync(file),original)
  fs.writeFileSync(file,'{"title":"After"}')
  assert.equal(readThumbnail(profile,file),null)
  assert.equal(writeThumbnail(profile,file,version,png),false,'stale async previews must not replace a newer project')
  for(const value of ['data:image/svg+xml,<svg/>','file:///private.png','data:image/png;base64,'+'A'.repeat(1100000)])assert.throws(()=>validateThumbnail(value))
  const bytes=Buffer.from(png.slice(22),'base64');bytes.writeUInt32BE(321,16)
  assert.throws(()=>validateThumbnail('data:image/png;base64,'+bytes.toString('base64')),/dimensions/)
  fs.rmSync(dir,{recursive:true,force:true})
})
test('thumbnail cache distinguishes case-distinct projects on case-sensitive volumes while unifying case aliases on case-insensitive volumes',()=>{
  const pngB='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQYV2P4z8DwHwAFgwJ/l7zR+QAAAABJRU5ErkJggg=='
  const root=path.resolve('artifacts/phase2');fs.mkdirSync(root,{recursive:true})
  const dir=fs.mkdtempSync(path.join(root,'project-thumbnail-case-')),profile=path.join(dir,'profile')
  try {
    const fileA=path.join(dir,'Mix','Demo.json'),fileB=path.join(dir,'mix','Demo.json')
    fs.mkdirSync(path.dirname(fileA),{recursive:true})
    fs.writeFileSync(fileA,'{"title":"Identical"}')
    if (fs.existsSync(fileB) && fs.realpathSync.native(fileA) === fs.realpathSync.native(fileB)) {
      const v=projectVersion(fileA)
      assert.equal(writeThumbnail(profile,fileA,v,png),true)
      assert.equal(readThumbnail(profile,fileB,v),png)
      const origRealpath=fs.realpathSync,origNative=fs.realpathSync.native
      fs.realpathSync=Object.assign(p=>path.resolve(p),{native:p=>path.resolve(p)})
      try {
        assert.equal(writeThumbnail(profile,fileA,v,png),true)
        assert.equal(writeThumbnail(profile,fileB,v,pngB),true)
        assert.equal(readThumbnail(profile,fileA,v),png)
        assert.equal(readThumbnail(profile,fileB,v),pngB)
      } finally {
        fs.realpathSync=origRealpath;fs.realpathSync.native=origNative
      }
    } else {
      fs.mkdirSync(path.dirname(fileB),{recursive:true})
      fs.writeFileSync(fileB,'{"title":"Identical"}')
      const vA=projectVersion(fileA),vB=projectVersion(fileB)
      assert.equal(writeThumbnail(profile,fileA,vA,png),true)
      assert.equal(writeThumbnail(profile,fileB,vB,pngB),true)
      assert.equal(readThumbnail(profile,fileA,vA),png)
      assert.equal(readThumbnail(profile,fileB,vB),pngB)
    }
  } finally {
    fs.rmSync(dir,{recursive:true,force:true})
  }
})

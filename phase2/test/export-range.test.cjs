const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { exportRange, assertRangeAudioMode } = require('../export-range.cjs')
const { MediaCache } = require('../project-media.cjs')
const { compositionProject, normalizeMixer } = require('../project.cjs')

test('export boundaries validate and align to the video clock', () => {
  assert.deepEqual(exportRange(undefined, 180), { start: 0, end: 180, duration: 180, partial: false })
  assert.deepEqual(exportRange({ start: 10.01, end: 20.01 }, 180), { start: 10, end: 20, duration: 10, partial: true })
  for (const range of [{start: -1,end:2},{start:2,end:1},{start:0,end:181},{start:'1',end:2},{start:NaN,end:2},{start:1,end:1.001}]) {
    assert.throws(() => exportRange(range, 180))
  }
  assert.throws(() => assertRangeAudioMode(exportRange({start:1,end:2},180), 'copy'), /accurate cuts/)
  for (const mode of ['aac','flac','master']) assertRangeAudioMode(exportRange({start:1,end:2},180), mode)
})

test('selected audio region preserves samples/rate and does not reuse full-song cache', async () => {
  const root = path.resolve('artifacts/phase2'); fs.mkdirSync(root,{recursive:true})
  const dir = fs.mkdtempSync(path.join(root,'range-unit-')), audioPath = path.join(dir,'tone.wav')
  const run = args => execFileSync('ffmpeg', ['-v','error',...args], {windowsHide:true,maxBuffer:8*1024*1024})
  run(['-f','lavfi','-i','aevalsrc=0.25*sin(2*PI*if(lt(t\\,1)\\,330\\,990)*t):s=96000:d=3','-c:a','pcm_f32le',audioPath])
  const cache = new MediaCache(path.join(dir,'cache'))
  try {
    const project = {...compositionProject(),audioPath,layers:[],mixer:normalizeMixer()}
    const full = await cache.prepare(project)
    assert.equal(full.outputPath,audioPath)
    const cut = await cache.prepare(project,undefined,{start:1,end:1.5})
    assert.equal(cut.metadata.duration,0.5);assert.equal(cut.metadata.totalFrames,15);assert.equal(cut.metadata.sampleRate,96000)
    const decode = file => run(['-i',file,'-f','f32le','-c:a','pcm_f32le','pipe:1'])
    assert.deepEqual(decode(cut.outputPath),decode(audioPath).subarray(96000*4,144000*4))
    const late = await cache.prepare(project,undefined,{start:2,end:2.5})
    assert.notEqual(late.outputPath,cut.outputPath)
  } finally {await cache.close()}
})


test('video range seeks the original picture and retains loop/freeze/hide behavior', async () => {
  const {VideoFrames} = require('../video-frames.cjs')
  const root=path.resolve('artifacts/phase2');fs.mkdirSync(root,{recursive:true})
  const dir=fs.mkdtempSync(path.join(root,'range-picture-')),videoPath=path.join(dir,'colors.mkv')
  execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','color=red:s=160x90:r=30:d=1','-f','lavfi','-i','color=blue:s=160x90:r=30:d=1','-f','lavfi','-i','color=green:s=160x90:r=30:d=1','-filter_complex','[0:v][1:v][2:v]concat=n=3:v=1:a=0[out]','-map','[out]','-c:v','ffv1',videoPath],{windowsHide:true})
  for(const [start,endBehavior,color] of [[1.5,'freeze',2],[3.5,'freeze',1],[3.5,'loop',0],[3.5,'hide',null]]) {
    const reader=new VideoFrames({videoPath,endBehavior},0.1,160,start)
    try {
      await new Promise(resolve => setTimeout(resolve, 400))
      const image=await reader.read()
      if(color===null) {assert.equal(image,'');continue}
      const rgb=execFileSync('ffmpeg',['-v','error','-i','pipe:0','-pix_fmt','rgb24','-f','rawvideo','pipe:1'],{input:Buffer.from(image.split(',')[1],'base64'),windowsHide:true})
      assert.ok(rgb[color]>rgb[(color+1)%3]+50 && rgb[color]>rgb[(color+2)%3]+50,`${start} ${endBehavior}: ${[...rgb.subarray(0,3)]}`)
    } finally {await reader.close()}
  }
})


test('range cuts retain delayed embedded-audio timing', async () => {
  const {videoLayer} = require('../project.cjs')
  const root=path.resolve('artifacts/phase2');fs.mkdirSync(root,{recursive:true})
  const dir=fs.mkdtempSync(path.join(root,'range-offset-')),song=path.join(dir,'audio.wav'),video=path.join(dir,'offset.mkv')
  const run=args=>execFileSync('ffmpeg',['-v','error',...args],{windowsHide:true,maxBuffer:8*1024*1024})
  run(['-f','lavfi','-i','aevalsrc=0.25*sin(2*PI*(330*t+100*t*t)):s=48000:d=3','-c:a','pcm_f32le',song])
  run(['-f','lavfi','-i','color=blue:s=160x90:r=30:d=3','-itsoffset','0.25','-i',song,'-map','0:v','-map','1:a','-c:v','ffv1','-c:a','pcm_f32le',video])
  const project={...compositionProject(),audioPath:'',layers:[{...videoLayer(),videoPath:video}],mixer:normalizeMixer()}
  const cache=new MediaCache(path.join(dir,'cache'))
  try {
    const full=await cache.prepare(project),cut=await cache.prepare(project,undefined,{start:1,end:1.5})
    const decode=file=>run(['-i',file,'-f','f32le','-c:a','pcm_f32le','pipe:1'])
    assert.deepEqual(decode(cut.outputPath),decode(full.outputPath).subarray(48000*4,72000*4))
  } finally {await cache.close()}
})

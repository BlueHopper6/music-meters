const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path')
const {waveformLayer,defaultProject,normalizeProject}=require('../project.cjs')
const {processColumns,configurations}=require('../../phase3/waveform.cjs')
const {analysisLanes}=require('../live-analysis.cjs')

test('channel choice round-trips while missing choices retain legacy left analysis',()=>{
  const layer=waveformLayer()
  assert.equal(configurations({layers:[layer]},48000)[0].channel,'left')
  assert.equal(normalizeProject({...defaultProject(),layers:[layer]}).layers[0].channel,undefined)
  for(const channel of ['left','right','mix','stereo-envelope']){
    assert.equal(normalizeProject({...defaultProject(),layers:[{...layer,channel}]}).layers[0].channel,channel)
  }
  for(const channel of ['both',null,{},3])assert.throws(()=>normalizeProject({...defaultProject(),layers:[{...layer,channel}]}),/channel input/)
  const layers=['left','right','mix','stereo-envelope'].map((channel,index)=>({...layer,id:'wave'+index,mode:'mono',channel}))
  assert.equal(analysisLanes({layers},48000).length,4,'different waveform inputs need independent native states during playback')
})

test('left/right and mono mix route the requested samples without changing PCM',()=>{
  const pcm={left:Float32Array.of(1,-1,0.5),right:Float32Array.of(-1,1,-0.5)}
  let received
  const native={processMono:values=>{received=values;return new Float32Array(0)}}
  processColumns(native,pcm,{mode:'mono',channel:'left'});assert.equal(received,pcm.left)
  processColumns(native,pcm,{mode:'mono',channel:'right'});assert.equal(received,pcm.right)
  processColumns(native,pcm,{mode:'mono',channel:'mix'});assert.deepEqual([...received],[0,0,0])
  assert.deepEqual([...pcm.left],[1,-1,0.5]);assert.deepEqual([...pcm.right],[-1,1,-0.5])
})

test('native stereo envelope keeps left above and right below without phase cancellation',()=>{
  const native=require(path.resolve('upstream/prism/native/build/Release/visualizer_dsp.node')).waveform
  const left=Float32Array.from({length:4800},(_,i)=>0.8*Math.sin(i*2*Math.PI*100/48000))
  const right=Float32Array.from(left,value=>-value/4)
  const peaks=channel=>{
    native.configure(48000,100);native.reset()
    return processColumns(native,{left,right},{mode:'mono',channel})
  }
  const envelope=peaks('stereo-envelope')
  assert.equal(envelope.length%5,0)
  const lower=[...envelope].filter((_,i)=>i%5===0),upper=[...envelope].filter((_,i)=>i%5===1)
  assert.ok(lower.every(value=>value<=0) && upper.every(value=>value>=0))
  assert.ok(Math.abs(Math.min(...lower)+0.2)<1e-5)
  assert.ok(Math.abs(Math.max(...upper)-0.8)<1e-5)
  const anti={left,right:Float32Array.from(left,value=>-value)}
  native.configure(48000,100);native.reset()
  const mixed=processColumns(native,anti,{mode:'mono',channel:'mix'})
  assert.ok([...mixed].every(value=>value===0),'opposite-phase mono mix cancels as expected')
  native.configure(48000,100);native.reset()
  assert.ok([...processColumns(native,anti,{mode:'mono',channel:'stereo-envelope'})].some(value=>value>0.79),'stereo envelope preserves both channels')
})


test('live waveform payloads match offline analysis for every single-waveform input',async()=>{
  const fs=require('node:fs'),{execFileSync}=require('node:child_process')
  const {LiveAnalysis}=require('../live-analysis.cjs'),{probeAudio}=require('../audio.cjs'),{previewWaveforms}=require('../../phase3/waveform.cjs')
  const root=path.resolve('artifacts/phase2');fs.mkdirSync(root,{recursive:true})
  const dir=fs.mkdtempSync(path.join(root,'waveform-channels-')),input=path.join(dir,'stereo.wav')
  execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','aevalsrc=0.4*sin(2*PI*100*t)|0.1*sin(2*PI*250*t):s=48000:d=0.2','-c:a','pcm_s24le',input],{windowsHide:true})
  const metadata=probeAudio(input),native=require(path.resolve('upstream/prism/native/build/Release/visualizer_dsp.node')).waveform
  for(const channel of ['left','right','mix','stereo-envelope']){
    const layer={...waveformLayer('wave'),mode:'mono',channel}
    const live=new LiveAnalysis(input,metadata,[layer],0)
    let frames
    try {frames=await live.pull(2)} finally {await live.close()}
    const offline=await previewWaveforms(input,metadata,1,{layers:[layer]},native)
    assert.equal(frames[1].waveforms.wave.entries[0].summary,offline.wave.entries.at(-1).summary,channel+' must use the same analysis in live and offline paths')
  }
})

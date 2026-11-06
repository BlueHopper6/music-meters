const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path')
const {randomUUID}=require('node:crypto')
const project=require('../project.cjs'),{PALETTES,applyPalette,nativeAppearance}=require('../meter-style.cjs')
const {saveTemplate,readTemplate,applyTemplate}=require('../templates.cjs')
const factories=['vectorscope','spectrum','oscilloscope','spectrogram','waveform','vu','loudness','waterfall']
test('legacy meters retain their previous defaults without new painter options',()=>{
  for(const type of factories){const layer=project[type+'Layer']();const normalized=project.normalizeProject({...project.defaultProject(),layers:[layer]}).layers[0];assert.deepEqual(normalized,layer);assert.deepEqual(nativeAppearance(normalized),{})}
})
test('six color presets round-trip on all eight meters without changing analysis or geometry',()=>{
  for(const type of factories)for(const id of Object.keys(PALETTES)){
    const original=project[type+'Layer'](),styled=applyPalette(original,id)
    const normalized=project.normalizeProject({...project.defaultProject(),layers:[styled]}).layers[0]
    assert.deepEqual(normalized.appearance,styled.appearance)
    for(const key of ['x','y','w','h','fftSize','smoothing','referenceDb','pitchLock','historySeconds','scrollSpeed'])assert.equal(normalized[key],original[key])
    assert.equal(normalized.color,PALETTES[id].colors[0])
  }
})
test('custom appearance rejects malformed colors, nonfinite values and unsupported modes',()=>{
  for(const appearance of [null,[],{lineWidth:0},{lineWidth:9},{gridOpacity:2},{fillOpacity:NaN},{labelOpacity:-1},{fillMode:'script'},{showGrid:'false'},{gridColor:'url(file://bad)'},{fillHighColor:'#abc'}])assert.throws(()=>project.normalizeProject({...project.defaultProject(),layers:[{...project.spectrumLayer(),appearance}]}),/appearance|fill mode/)
  assert.throws(()=>applyPalette(project.spectrumLayer(),'__proto__'),/color preset/)
})
test('appearance survives template save and application while preserving the current song',()=>{
  const dir=path.resolve('artifacts/phase2/meter-style-'+randomUUID());fs.mkdirSync(dir,{recursive:true})
  const styled={...project.compositionProject(),audioPath:'',layers:[applyPalette(project.spectrumLayer(),'ember')]}
  const entry=saveTemplate(dir,'Styled',styled),layout=readTemplate(dir,entry.id).layout
  assert.deepEqual(layout.layers[0].appearance,styled.layers[0].appearance)
  const song={...project.compositionProject(),audioPath:'C:/music/song.wav',audioStorage:'copy'}
  const applied=applyTemplate(layout,song)
  assert.equal(applied.audioPath,song.audioPath);assert.equal(applied.audioStorage,'copy');assert.deepEqual(applied.layers[0].appearance,styled.layers[0].appearance)
})
test('editing one appearance field preserves the other displayed defaults',()=>{
  assert.deepEqual(nativeAppearance({...project.spectrogramLayer(),appearance:{fillLowColor:'#123456'}}).heatColors,['#123456','#a31a79','#fff1d1'])
  assert.equal(nativeAppearance({...project.waterfallLayer(),appearance:{gridColor:'#ff0000'}}).gridColor,'rgba(255,0,0,0.25)')
  assert.equal(nativeAppearance({...project.oscilloscopeLayer(),appearance:{scopeFillOpacity:0.4}}).underfillColor,'rgba(245,248,252,0.4)')
})

test('preset labels follow normalized applied colors and custom edits',()=>{
  const {matchingPalette}=require('../meter-style.cjs')
  for(const type of factories)for(const id of Object.keys(PALETTES)){
    const layer=applyPalette(project[type+'Layer'](),id)
    const saved=project.normalizeProject({...project.defaultProject(),layers:[layer]}).layers[0]
    assert.equal(matchingPalette(saved),id)
    saved.appearance.lineWidth=3
    assert.equal(matchingPalette(saved),id,'trace tuning keeps the color preset identity')
    saved.color='#123456'
    assert.equal(matchingPalette(saved),'','custom colors must not claim a preset')
  }
})

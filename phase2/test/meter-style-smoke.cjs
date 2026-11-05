const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path')
const {app}=require('electron')
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))
module.exports=async function(win){
  const dir=process.env.MUSICMETERS_STYLE_DIR,evaluate=source=>win.webContents.executeJavaScript(source)
  const click=id=>evaluate(`document.getElementById(${JSON.stringify(id)}).click()`)
  async function wait(source,label){
    const deadline=Date.now()+120000
    while(Date.now()<deadline){if(await evaluate(source))return;await delay(80)}
    fs.writeFileSync(path.join(dir,'failure.png'),(await win.capturePage()).toPNG())
    throw new Error(label+': '+await evaluate('document.getElementById("status").textContent'))
  }
  const ready=()=>wait('document.getElementById("preview-busy").hidden && !document.getElementById("editor-screen").inert','ready')
  async function change(id,value){await evaluate(`(()=>{const el=document.getElementById(${JSON.stringify(id)});${typeof value==='boolean'?'el.checked':'el.value'}=${JSON.stringify(value)};el.dispatchEvent(new Event('change',{bubbles:true}));})()`);await ready()}
  async function select(type){await evaluate(`document.querySelector('.layer-item[data-id="style-${type}"]').click()`)}
  async function save(){await click('save-project');await wait('!document.getElementById("editor-screen").inert && document.getElementById("status").textContent.startsWith("Saved project:")','save');return JSON.parse(fs.readFileSync(process.env.PHASE2_TEST_PROJECT_PATH))}
  async function stage(name){const png=await evaluate('document.getElementById("stage").toDataURL("image/png").split(",")[1]');fs.writeFileSync(path.join(dir,name),Buffer.from(png,'base64'));return png}
  await wait('document.getElementById("status").textContent.includes("Real Prism")','initial')
  await click('open-project')
  await wait('document.querySelectorAll(".layer-item").length===8 && document.getElementById("status").textContent.includes("Real Prism") && document.getElementById("preview-busy").hidden','eight meters')
  const baseline=await stage('original.png')
  const types=['vectorscope','spectrum','oscilloscope','spectrogram','waveform','vu','loudness','waterfall']
  for(const [index,type] of types.entries()){
    await select(type)
    assert.equal(await evaluate('document.getElementById("meter-style-options").hidden'),false)
    await change('meter-palette',['neon','ember','ice','forest','prism','ember','ice','mono'][index])
    await change('meter-grid-opacity',25)
    if(['vectorscope','spectrum','oscilloscope'].includes(type))await change('meter-trace-width',3)
  }
  await select('spectrum')
  await change('meter-fill-mode','none');const line=await stage('spectrum-line.png')
  await change('meter-fill-mode','gradient');const gradient=await stage('spectrum-gradient.png');assert.notEqual(line,gradient)
  await change('meter-fill-mode','heat');const heat=await stage('spectrum-heat.png');assert.notEqual(gradient,heat)
  assert.notEqual(line,heat,'heat map must differ from the plain spectrum line')
  const fillPixels=await evaluate(`(async()=>{
    const load=async data=>{const im=new Image();im.src='data:image/png;base64,'+data;await im.decode();const c=document.createElement('canvas');c.width=1280;c.height=720;const ctx=c.getContext('2d');ctx.drawImage(im,0,0);return ctx.getImageData(345,30,280,290).data}
    const a=await load(${JSON.stringify(line)}),b=await load(${JSON.stringify(heat)});let changed=0
    for(let i=0;i<a.length;i+=4)if(Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2])>12)changed++
    return changed
  })()`)
  assert.ok(fillPixels>1500,`Heat map must paint a visible interior, changed ${fillPixels} pixels`)
  await change('meter-fill-mode','gradient')
  await change('meter-side-color','#ff4ba8');await change('meter-fill-opacity',70)
  await change('meter-trace-width',3.25)
  await click('undo-project');await ready();assert.equal(await evaluate('document.getElementById("meter-trace-width").value'),'3')
  await click('redo-project');await ready();assert.equal(await evaluate('document.getElementById("meter-trace-width").value'),'3.25')
  const customized=await save(),spectrum=customized.layers.find(layer=>layer.type==='spectrum')
  assert.equal(spectrum.appearance.secondaryColor,'#ff4ba8');assert.equal(spectrum.appearance.fillMode,'gradient')
  await click('meter-style-reset');const reset=await save(),resetLayer=reset.layers.find(layer=>layer.type==='spectrum')
  assert.equal(resetLayer.appearance,undefined);assert.equal(resetLayer.w,spectrum.w);assert.equal(resetLayer.fftSize,spectrum.fftSize)
  await click('undo-project');await ready();assert.equal(await evaluate('document.getElementById("meter-trace-width").value'),'3.25')
  await change('layer-locked',true)
  assert.equal(await evaluate('document.getElementById("meter-palette").disabled'),true)
  await change('layer-locked',false)
  await change('meter-fill-mode','heat')
  const final=await save();assert.equal(final.layers.filter(layer=>layer.appearance).length,8)
  win.showInactive();win.setSize(1480,900)
  await evaluate('document.getElementById("meter-style-details").open=true;document.getElementById("meter-style-options").scrollIntoView({block:"start"})')
  await delay(200);fs.writeFileSync(path.join(dir,'style-controls.png'),(await win.capturePage()).toPNG())
  await change('time-input','1.5')
  await wait('document.getElementById("stage").dataset.previewFrame==="45" && document.getElementById("playback-cancel").hidden','late live frame')
  await click('refresh-still')
  await wait('document.getElementById("status").textContent.includes("Real Prism meter still at 1.50 s.") && document.getElementById("preview-busy").hidden','late full-history still')
  await stage('all-eight-styled.png')
  await stage('heat-late.png')
  // Reopen to get a fresh painter for the first-frame parity comparison.
  await click('close-project');await wait('!document.getElementById("project-manager-screen").hidden','closed')
  await click('open-project')
  await wait('document.querySelectorAll(".layer-item").length===8 && Number(document.getElementById("time-slider").value)===0 && document.getElementById("status").textContent.includes("Real Prism") && document.getElementById("preview-busy").hidden','reopened styled meters')
  assert.notEqual(await stage('preview-first.png'),baseline)
  await change('export-preset','720p');await change('audio-mode','master')
  await click('open-export');await click('render-mp4')
  await wait('document.getElementById("status").textContent.startsWith("MKV ready:")','styled master export')
  console.log(JSON.stringify({event:'meter-style-pass',meters:8,presets:6,undo:true,reset:true,locked:true,export:true}))
  app.quit()
}

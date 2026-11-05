const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path')
const {app,dialog}=require('electron')
const {compositionProject,imageLayer,videoLayer}=require('../project.cjs')
const {readLibraryProject}=require('../project-library.cjs')
module.exports=async function(win){
  const evaluate=source=>win.webContents.executeJavaScript(source),dir=process.env.MUSICMETERS_STORAGE_DIR
  let response=0,count=0
  dialog.showMessageBox=async(_win,options)=>{
    assert.equal(options.title,'Store imported media')
    assert.deepEqual(options.buttons,['Copy into project','Link original','Cancel'])
    assert.match(options.detail,/when you save/);count++;return {response}
  }
  for(const storage of ['copy','link']){
    response=storage==='copy'?0:1
    const imported=await evaluate(`(async()=>({audio:await window.desktop.chooseAudio(),video:await window.desktop.chooseVideo(),image:await window.desktop.chooseImage()}))()`)
    for(const media of Object.values(imported))assert.equal(media.storage,storage)
    const project={...compositionProject(),title:storage,audioPath:imported.audio.path,audioStorage:storage,layers:[{...imageLayer('art'),imagePath:imported.image.path,storage},{...videoLayer('clip'),videoPath:imported.video.path,storage}]}
    process.env.PHASE2_TEST_PROJECT_PATH=path.join(dir,storage,storage+'.json')
    const saved=await evaluate(`window.desktop.saveProject(${JSON.stringify(project)},true)`)
    const reopened=readLibraryProject(saved.path).project
    assert.equal(reopened.audioStorage,storage)
    for(const [original,current] of [[imported.audio.path,reopened.audioPath],[imported.image.path,reopened.layers[0].imagePath],[imported.video.path,reopened.layers[1].videoPath]]){
      assert.equal(original===current,storage==='link');assert.ok(fs.existsSync(current))
      assert.deepEqual(fs.readFileSync(original),fs.readFileSync(current))
    }
    await evaluate(`window.desktop.loadAssets(${JSON.stringify(saved.project)})`)
    await evaluate(`window.desktop.mediaInfo(${JSON.stringify(saved.project)})`)
    if(storage==='copy'){
      process.env.PHASE2_TEST_PROJECT_PATH=path.join(dir,'save-as','save-as.json')
      const second=await evaluate(`window.desktop.saveProject(${JSON.stringify(saved.project)},true)`)
      assert.notEqual(second.project.audioPath,saved.project.audioPath)
      assert.notEqual(second.project.layers[1].videoPath,saved.project.layers[1].videoPath)
    }
  }
  response=2
  const before=await evaluate('window.desktop.initial()')
  for(const method of ['chooseImage','chooseAudio','chooseVideo'])assert.equal(await evaluate(`window.desktop.${method}()`),null)
  assert.deepEqual((await evaluate('window.desktop.initial()')).project,before.project)
  assert.equal(count,9)
  const previous=fs.readFileSync(process.env.PHASE2_TEST_PROJECT_PATH)
  const failing={...before.project,audioStorage:'copy'}
  const copyFile=fs.promises.copyFile,closeWindow=win.close.bind(win)
  let deferred=false,guardCalls=0
  win.close=()=>{guardCalls++}
  fs.promises.copyFile=async()=>{
    win.emit('close',{preventDefault(){deferred=true}})
    await assert.rejects(evaluate('window.desktop.chooseAudio()'),/project operation/)
    throw new Error('Injected media-copy failure')
  }
  try { await assert.rejects(evaluate(`window.desktop.saveProject(${JSON.stringify(failing)})`),/Injected media-copy failure/) }
  finally {fs.promises.copyFile=copyFile;win.close=closeWindow}
  assert.equal(deferred,true);assert.equal(guardCalls,1,'failed save must return to close guard instead of quitting')
  assert.deepEqual(fs.readFileSync(process.env.PHASE2_TEST_PROJECT_PATH),previous)
  async function wait(source,label){
    const deadline=Date.now()+45000
    while(Date.now()<deadline){if(await evaluate(source))return;await new Promise(resolve=>setTimeout(resolve,80))}
    throw new Error(label+': '+await evaluate('document.getElementById("status").textContent'))
  }
  const click=id=>evaluate(`document.getElementById(${JSON.stringify(id)}).click()`)
  response=0
  await click('import-audio')
  await wait('document.getElementById("status").textContent.includes("Real Prism") && document.getElementById("title").value==="song"','first source name')
  process.env.PHASE2_TEST_PROJECT_PATH=path.join(dir,'names','names.json')
  await click('save-project')
  await wait('!document.getElementById("editor-screen").inert && document.getElementById("status").textContent.startsWith("Saved project:")','named save')
  await click('open-project')
  await wait('document.getElementById("status").textContent.includes("Real Prism") && document.getElementById("audio-name").textContent==="song.wav"','copied name after reopening')
  process.env.PHASE2_TEST_IMPORT_PATH=path.join(dir,'next-song.wav')
  await click('import-audio')
  await wait('document.getElementById("status").textContent.includes("Real Prism") && document.getElementById("title").value==="next song"','automatic title after replacing copied audio')
  await click('import-video')
  await wait('document.getElementById("status").textContent.includes("Real Prism") && document.getElementById("video-name").textContent==="clip.mp4" && document.getElementById("cancel-media").hidden','video source name')
  await click('save-project')
  await wait('!document.getElementById("editor-screen").inert && document.getElementById("status").textContent.startsWith("Saved project:")','video name saved')
  const named=JSON.parse(fs.readFileSync(process.env.PHASE2_TEST_PROJECT_PATH))
  assert.equal(named.audioName,'next-song.wav')
  const video=named.layers.find(layer=>layer.type==='video');assert.equal(video.sourceName,'clip.mp4')
  await click('open-project')
  await wait('document.getElementById("status").textContent.includes("Real Prism") && document.getElementById("audio-name").textContent==="next-song.wav"','reopen named media')
  await evaluate(`document.querySelector(${JSON.stringify('.layer-item[data-id="'+video.id+'"]')}).click()`)
  assert.equal(await evaluate('document.getElementById("video-name").textContent'),'clip.mp4')
  assert.equal(count,12)
  console.log(JSON.stringify({event:'media-storage-pass',prompts:count,copy:true,link:true,cancel:true,saveAs:true,failedSaveCloseGuard:true,sourceNames:true,automaticTitle:true}))
  app.quit()
}

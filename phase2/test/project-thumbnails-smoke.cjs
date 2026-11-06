const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict')
const {app,nativeImage}=require('electron'),{VideoFrames}=require('../video-frames.cjs')
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))
module.exports=async function(win){
  const dir=process.env.MUSICMETERS_THUMBNAIL_DIR,evaluate=s=>win.webContents.executeJavaScript(s).catch(error=>{console.error('Thumbnail evaluation:',s);throw error})
  const click=id=>evaluate(`document.getElementById(${JSON.stringify(id)}).click()`)
  async function wait(source,label){console.log(JSON.stringify({event:'thumbnail-wait',label}));const end=Date.now()+60000;while(Date.now()<end){if(await evaluate(source))return;await delay(70)}fs.writeFileSync(path.join(dir,'failure.png'),(await win.capturePage()).toPNG());throw Error(label+': '+await evaluate('document.getElementById("status").textContent'))}
  async function change(id,value){await evaluate(`(()=>{const e=document.getElementById(${JSON.stringify(id)});${typeof value==='boolean'?'e.checked':'e.value'}=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))})()`)}
  const color=url=>{const bitmap=nativeImage.createFromDataURL(url).toBitmap();return [...bitmap.subarray(0,3)]}
  const saved=path.join(dir,'current.json'),legacy=path.join(dir,'legacy.json')
  await wait('document.getElementById("status").textContent.includes("Real Prism")','initial')
  await click('open-project');await wait('document.querySelector(".layer-item[data-id=video]") && document.getElementById("cancel-media").hidden && !document.getElementById("editor-screen").inert','opened')
  await change('time-input','1.5');await wait('document.getElementById("stage").dataset.previewFrame==="45"','seek')
  await click('save-project');await wait('document.getElementById("status").textContent.startsWith("Saved project:")','save with preview')
  const current=await evaluate(`window.desktop.getProjectThumbnail(${JSON.stringify(saved)})`)
  assert.ok(current.url);assert.ok(color(current.url)[0]>200 && color(current.url)[2]<80,'saved preview should show blue video at the selected playhead')
  await click('close-project');await wait('!document.getElementById("project-manager-screen").hidden','manager')
  await wait('document.querySelectorAll(".project-card-thumb img").length===3','all thumbnails')
  const older=await evaluate(`window.desktop.getProjectThumbnail(${JSON.stringify(legacy)})`)
  assert.ok(older.url);assert.ok(color(older.url)[2]>200 && color(older.url)[0]<80,'legacy preview picks a representative early red frame')
  assert.equal(await evaluate('Array.from(document.querySelectorAll(".project-card-thumb img")).every(i=>Math.max(i.naturalWidth,i.naturalHeight)<=320 && getComputedStyle(i).objectFit==="contain")'),true)
  await assert.rejects(()=>evaluate(`window.desktop.getProjectThumbnail(${JSON.stringify(path.join(dir,'unlisted.json'))})`),/recent projects/)
  await assert.rejects(()=>evaluate(`window.desktop.cacheProjectThumbnail(${JSON.stringify(saved)},${JSON.stringify(current.version)},'data:image/svg+xml,<svg/>')`),/Invalid project thumbnail/)
  win.showInactive();await delay(200);fs.writeFileSync(path.join(dir,'project-manager-thumbnails.png'),(await win.capturePage()).toPNG())
  await evaluate(`Array.from(document.querySelectorAll('.project-card')).find(c=>c.dataset.projectPath===${JSON.stringify(saved)}).click()`)
  await wait('document.querySelector(".layer-item[data-id=video]") && !document.getElementById("editor-screen").hidden && !document.getElementById("editor-screen").inert && document.getElementById("cancel-media").hidden && document.getElementById("status").textContent.includes("Real Prism")','reopen')
  await evaluate('document.querySelector(".layer-item[data-id=video]").click()');await change('layer-visible',false);await change('background','#00ff00')
  await click('save-project');await wait('document.getElementById("status").textContent.startsWith("Saved project:")','refresh preview')
  const refreshed=await evaluate(`window.desktop.getProjectThumbnail(${JSON.stringify(saved)})`)
  assert.notEqual(refreshed.url,current.url);assert.ok(color(refreshed.url)[1]>200,'saving updates preview')
  const read=VideoFrames.prototype.read;VideoFrames.prototype.read=async()=>{throw Error('Injected preview failure')}
  try{
    await change('layer-visible',true);await click('save-project')
    await wait('document.getElementById("status").textContent.startsWith("Saved project:")','thumbnail failure does not block saving')
  }finally{VideoFrames.prototype.read=read}
  console.log(JSON.stringify({event:'project-thumbnails-pass',savedFrame:true,legacyBackfill:true,portrait:true,saveRefresh:true,thumbnailFailureSave:true,trustedRecentOnly:true}))
  app.quit()
}

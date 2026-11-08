const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path')
const {app,dialog}=require('electron'),{VideoPreviewCache}=require('../video-frames.cjs')
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))
module.exports=async function(win){
 const dir=process.env.MUSICMETERS_FEEDBACK_DIR,evaluate=s=>win.webContents.executeJavaScript(s).catch(error=>{console.error('Evaluation failed:',s);throw error})
 const click=id=>evaluate(`document.getElementById(${JSON.stringify(id)}).click()`)
 async function wait(source,label){const end=Date.now()+45000;while(Date.now()<end){if(await evaluate(source))return;await delay(60)}throw new Error(label+': '+await evaluate('document.getElementById("status").textContent'))}
 const idle=()=>wait('document.getElementById("preview-busy").hidden && document.getElementById("cancel-media").hidden && !document.getElementById("editor-screen").inert','idle')
 await wait('document.getElementById("status").textContent.includes("Real Prism") && document.getElementById("splash-screen").hidden','ready')
 await evaluate('document.getElementById("add-type").value="image"');await click('add-layer');await click('image-choose')
 await wait('!document.getElementById("error-notice").hidden','image failure notice')
 assert.equal(await evaluate('document.getElementById("error-notice").getAttribute("role")'),'alert')
 assert.match(await evaluate('document.getElementById("error-notice-title").textContent'),/Image/)
 assert.match(await evaluate('document.getElementById("error-notice-message").textContent'),/MB/)
 assert.doesNotMatch(await evaluate('document.getElementById("error-notice").textContent'),/invoking remote|choose-image|Error:/)
 assert.doesNotMatch(await evaluate('document.getElementById("status").textContent'),/invoking remote/)
 win.showInactive();await delay(150);fs.writeFileSync(path.join(dir,'image-error.png'),(await win.capturePage()).toPNG())
 await click('refresh-still');await idle();assert.equal(await evaluate('document.getElementById("error-notice").hidden'),false,'normal still progress must not dismiss an important error')
 await click('error-notice-dismiss');assert.equal(await evaluate('document.getElementById("error-notice").hidden'),true)
 const picker=dialog.showOpenDialog
 delete process.env.PHASE4_TEST_IMAGE_PATH;dialog.showOpenDialog=async()=>({canceled:true,filePaths:[]})
 await click('image-choose');await idle();assert.equal(await evaluate('document.getElementById("error-notice").hidden'),true,'cancel is not an error')
 dialog.showOpenDialog=picker
 const prepare=VideoPreviewCache.prototype.prepare,cancel=VideoPreviewCache.prototype.cancel
 let release,cancelRelease,seen=false,fail=false,cancelling=false,cancelSeen=false
 const gate=new Promise(resolve=>{release=resolve})
 const cancelledGate=new Promise(resolve=>{cancelRelease=resolve})
 VideoPreviewCache.prototype.prepare=async function(...args){seen=true;if(fail)throw new Error('Injected video preview failure');if(cancelling){cancelSeen=true;await cancelledGate;throw new Error('Media preparation cancelled')}await gate;return prepare.apply(this,args)}
 VideoPreviewCache.prototype.cancel=function(){cancel.call(this);if(cancelling)cancelRelease()}
 try{
  await click('import-video')
  const deadline=Date.now()+30000;while(!seen && Date.now()<deadline)await delay(50)
  assert.equal(seen,true,'proxy preparation must be reached')
  assert.equal(await evaluate('document.getElementById("video-loading").hidden'),false)
  assert.equal(await evaluate('document.getElementById("stage").getAttribute("aria-busy")'),'true')
  assert.match(await evaluate('document.getElementById("video-loading").textContent'),/Loading video/)
  await delay(150);fs.writeFileSync(path.join(dir,'loading-video.png'),(await win.capturePage()).toPNG())
  release()
  await wait('document.getElementById("video-loading").hidden && document.getElementById("preview-busy").hidden && document.getElementById("status").textContent.includes("Real Prism")','decoded video ready')
  assert.equal(await evaluate('document.getElementById("stage").getAttribute("aria-busy")'),'false')
  // Preview video uses a separate origin; inspect the rendered window rather than
  // reading a video-tainted canvas through getImageData.
  const point=await evaluate('(()=>{const r=document.getElementById("stage").getBoundingClientRect();return {x:Math.round(r.x+r.width*0.02),y:Math.round(r.y+r.height*0.9)}})()')
  const screenshot=await win.capturePage();fs.writeFileSync(path.join(dir,'ready-video.png'),screenshot.toPNG())
  // DOM coordinates are page coordinates; cropping the full native bitmap
  // instead samples the wrong location on Retina displays.
  const pixel=(await win.webContents.capturePage({...point,width:1,height:1})).toBitmap()
  console.log(JSON.stringify({event:'feedback-video-pixel',point,imageSize:screenshot.getSize(),windowSize:win.getContentSize(),scaleFactors:screenshot.getScaleFactors(),bgr:[...pixel.subarray(0,3)]}))
  assert.ok(pixel[0]>pixel[2]+50,'decoded blue picture must be on the canvas when loading finishes')
  cancelling=true;await click('import-video')
  const cancelDeadline=Date.now()+30000;while(!cancelSeen && Date.now()<cancelDeadline)await delay(50)
  assert.equal(cancelSeen,true);await click('cancel-media')
  await wait('document.getElementById("video-loading").hidden && document.getElementById("cancel-media").hidden','cancelled video stops loading')
  assert.equal(await evaluate('document.getElementById("error-notice").hidden'),true,'intentional cancellation must not show an error notice')
  cancelling=false;fail=true;await click('import-video')
  await wait('!document.getElementById("error-notice").hidden && document.getElementById("video-loading").hidden','failed video stops loading')
  assert.match(await evaluate('document.getElementById("error-notice-message").textContent'),/Injected video preview failure/)
  assert.doesNotMatch(await evaluate('document.getElementById("error-notice-message").textContent'),/invoking remote/)
 }finally{release();cancelRelease();VideoPreviewCache.prototype.prepare=prepare;VideoPreviewCache.prototype.cancel=cancel}
 await click('error-notice-dismiss')
 process.env.PHASE2_TEST_PROJECT_PATH=path.join(dir,'saved.json')
 await click('save-project');await wait('document.getElementById("status").textContent.startsWith("Saved project:") && !document.getElementById("editor-screen").inert','initial save')
 const original=fs.readFileSync(process.env.PHASE2_TEST_PROJECT_PATH),rename=fs.renameSync
 fs.renameSync=(from,to)=>{if(to===process.env.PHASE2_TEST_PROJECT_PATH)throw Object.assign(new Error('EACCES: injected save failure'),{code:'EACCES'});return rename(from,to)}
 try{
  await click('save-project');await wait('!document.getElementById("error-notice").hidden && !document.getElementById("editor-screen").inert','save failure notice')
  assert.match(await evaluate('document.getElementById("error-notice-title").textContent'),/saved/)
  assert.match(await evaluate('document.getElementById("error-notice-message").textContent'),/(Windows|macOS) blocked access/)
  assert.deepEqual(fs.readFileSync(process.env.PHASE2_TEST_PROJECT_PATH),original)
 }finally{fs.renameSync=rename}
 console.log(JSON.stringify({event:'user-feedback-pass',imageError:true,persistent:true,cancelQuiet:true,videoCancelQuiet:true,loadingUntilDecoded:true,loadingFailureClears:true,saveError:true,previousSaveIntact:true}))
 app.quit()
}

const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict')
const {spawn,execFileSync}=require('node:child_process'),{createHash}=require('node:crypto')
const {packagedExecutable}=require('../packaged-executable.cjs'),project=require('../../phase2/project.cjs')
const run=(name,args)=>execFileSync(name,args,{windowsHide:true,maxBuffer:32*1024*1024})
async function main(){
  const dir=path.resolve(process.argv[3]);if(fs.existsSync(dir))throw new Error('Choose a fresh output directory')
  fs.mkdirSync(dir,{recursive:true});fs.mkdirSync(path.join(dir,'temp'))
  const audio=path.join(dir,'song.wav'),file=path.join(dir,'project.json'),output=path.join(dir,'styled.mkv')
  run('ffmpeg',['-v','error','-f','lavfi','-i','aevalsrc=0.15*sin(2*PI*if(lt(t\\,1)\\,330\\,660)*t)|0.13*sin(2*PI*if(lt(t\\,1)\\,440\\,880)*t):s=48000:d=2','-c:a','pcm_s24le',audio])
  const types=['vectorscope','spectrum','oscilloscope','spectrogram','waveform','vu','loudness','waterfall']
  const layers=types.map((type,index)=>({...project[type+'Layer']('style-'+type),x:20+(index%4)*315,y:20+Math.floor(index/4)*345,w:300,h:325}))
  layers[0].multiband=true;layers[1].showSideLine=true;layers[2].underfillEnabled=true;layers[4].multiband=true;layers[7].colorMode='heat'
  fs.writeFileSync(file,JSON.stringify({...project.compositionProject(),title:'Meter styling',audioPath:undefined,audioRelativePath:'song.wav',layers}))
  const fd=fs.openSync(path.join(dir,'editor.log'),'wx')
  const child=spawn(packagedExecutable(path.resolve(process.argv[2])),[],{env:{...process.env,TEMP:path.join(dir,'temp'),TMP:path.join(dir,'temp'),PHASE2_HEADLESS:'1',PHASE2_TEST_INPUT:audio,PHASE2_TEST_PROJECT_PATH:file,PHASE2_TEST_OUTPUT_PATH:output,PHASE5_TEST_USER_DATA:path.join(dir,'profile'),MUSICMETERS_STYLE_SMOKE:'1',MUSICMETERS_STYLE_DIR:dir},stdio:['ignore',fd,fd],windowsHide:true})
  const code=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.kill();reject(new Error('Meter style smoke timed out'))},300000);child.once('error',reject);child.once('close',code=>{clearTimeout(timer);resolve(code)})})
  fs.closeSync(fd);const log=fs.readFileSync(path.join(dir,'editor.log'),'utf8');assert.equal(code,0,log);assert.match(log,/"event":"meter-style-pass"/)
  const pixels=input=>run('ffmpeg',['-v','error','-i',input,'-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','pipe:1'])
  const encoded=pixels(output),rendered=pixels(output+'.rendered.png'),preview=pixels(path.join(dir,'preview-first.png'))
  assert.deepEqual(encoded,rendered,'lossless master retains the styled rendered frame exactly')
  assert.equal(preview.length,rendered.length)
  let difference=0;for(let i=0;i<preview.length;i++)difference+=Math.abs(preview[i]-rendered[i])
  const meanDifference=difference/preview.length
  assert.ok(meanDifference<=1,`Preview/export mean channel difference ${meanDifference}`)
  const crop=['-vf','crop=280:290:345:30','-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','pipe:1']
  const lateExport=run('ffmpeg',['-v','error','-ss','1.5','-i',output,...crop])
  const lateStill=run('ffmpeg',['-v','error','-i',path.join(dir,'heat-late.png'),...crop])
  const firstHeat=run('ffmpeg',['-v','error','-i',path.join(dir,'spectrum-heat.png'),...crop])
  let changedFill=0
  for(let i=0;i<firstHeat.length;i+=3)if(Math.abs(firstHeat[i]-lateStill[i])+Math.abs(firstHeat[i+1]-lateStill[i+1])+Math.abs(firstHeat[i+2]-lateStill[i+2])>12)changedFill++
  assert.ok(changedFill>1500,`Heat fill must follow changing audio instead of freezing: ${changedFill} pixels`)
  assert.deepEqual(lateStill,lateExport,'late heat-map still must match export without renderer history')
  run('ffmpeg',['-v','error','-xerror','-i',output,'-f','null','-'])
  const result={code,meanDifference,pixelHash:createHash('sha256').update(encoded).digest('hex')}
  fs.writeFileSync(path.join(dir,'verification.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({dir,...result}))
}
main().catch(error=>{console.error(error.stack||error);process.exitCode=1})

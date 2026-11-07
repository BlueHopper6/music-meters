const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict')
const {spawn,execFileSync}=require('node:child_process'),{packagedExecutable}=require('../packaged-executable.cjs')
async function main(){
 const dir=path.resolve(process.argv[3]);if(fs.existsSync(dir))throw new Error('Use fresh output directory')
 fs.mkdirSync(dir,{recursive:true});fs.mkdirSync(path.join(dir,'temp'))
 const audio=path.join(dir,'song.wav'),video=path.join(dir,'clip.mp4'),image=path.join(dir,'large.png')
 for(const[file,args]of[[audio,['-f','lavfi','-i','sine=frequency=440:duration=0.3','-c:a','pcm_s24le']],[video,['-f','lavfi','-i','color=c=blue:size=160x90:rate=30:duration=0.3','-an','-c:v','libx264']]])execFileSync('ffmpeg',['-v','error',...args,file],{windowsHide:true})
 const imageFd=fs.openSync(image,'wx');fs.ftruncateSync(imageFd,17*1024*1024);fs.closeSync(imageFd)
 const fd=fs.openSync(path.join(dir,'editor.log'),'wx')
 const child=spawn(packagedExecutable(path.resolve(process.argv[2])),[],{env:{...process.env,TEMP:path.join(dir,'temp'),TMP:path.join(dir,'temp'),TMPDIR:path.join(dir,'temp'),PHASE2_HEADLESS:'1',PHASE2_TEST_INPUT:audio,MUSICMETERS_TEST_VIDEO:video,PHASE4_TEST_IMAGE_PATH:image,PHASE5_TEST_USER_DATA:path.join(dir,'profile'),MUSICMETERS_FEEDBACK_SMOKE:'1',MUSICMETERS_FEEDBACK_DIR:dir},stdio:['ignore',fd,fd],windowsHide:true})
 const code=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.kill();reject(new Error('Feedback smoke timed out'))},120000);child.once('error',reject);child.once('close',code=>{clearTimeout(timer);resolve(code)})})
 fs.closeSync(fd);const log=fs.readFileSync(path.join(dir,'editor.log'),'utf8');assert.equal(code,0,log);assert.match(log,/user-feedback-pass/);console.log(JSON.stringify({dir,code}))
}
main().catch(e=>{console.error(e);process.exitCode=1})

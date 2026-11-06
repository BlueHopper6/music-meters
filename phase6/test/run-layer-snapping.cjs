const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict')
const {spawn,execFileSync}=require('node:child_process'),{packagedExecutable}=require('../packaged-executable.cjs'),{compositionProject,textLayer}=require('../../phase2/project.cjs')
async function main(){
 const dir=path.resolve(process.argv[3]);if(fs.existsSync(dir))throw new Error('Use fresh output directory')
 fs.mkdirSync(dir,{recursive:true});fs.mkdirSync(path.join(dir,'temp'))
 const audio=path.join(dir,'song.wav'),file=path.join(dir,'project.json')
 execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','sine=frequency=440:duration=6','-c:a','pcm_s24le',audio],{windowsHide:true})
 const target={...textLayer('target','Reference','Reference'),x:400,y:300,w:200,h:160,background:{enabled:true,color:'#284b63',opacity:1}}
 const moving={...textLayer('moving','Moving','Drag me'),x:100,y:100,w:100,h:80,background:{enabled:true,color:'#48365e',opacity:1}}
 fs.writeFileSync(file,JSON.stringify({...compositionProject(),title:'Layer snapping',audioPath:undefined,audioRelativePath:'song.wav',layers:[target,moving]}))
 const fd=fs.openSync(path.join(dir,'editor.log'),'wx')
 const child=spawn(packagedExecutable(path.resolve(process.argv[2])),[],{env:{...process.env,TEMP:path.join(dir,'temp'),TMP:path.join(dir,'temp'),PHASE2_HEADLESS:'1',PHASE2_TEST_INPUT:audio,PHASE2_TEST_PROJECT_PATH:file,PHASE5_TEST_USER_DATA:path.join(dir,'profile'),MUSICMETERS_SNAPPING_SMOKE:'1',MUSICMETERS_SNAPPING_DIR:dir},stdio:['ignore',fd,fd],windowsHide:true})
 const code=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.kill();reject(new Error('Snapping smoke timed out'))},120000);child.once('error',reject);child.once('close',code=>{clearTimeout(timer);resolve(code)})})
 fs.closeSync(fd);const log=fs.readFileSync(path.join(dir,'editor.log'),'utf8');assert.equal(code,0,log);assert.match(log,/layer-snapping-pass/);const pixels=file=>execFileSync('ffmpeg',['-v','error','-i',file,'-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','pipe:1'],{windowsHide:true,maxBuffer:16*1024*1024});assert.deepEqual(pixels(path.join(dir,'clipped.mkv')),pixels(path.join(dir,'clipped-preview.png')),'off-canvas clipping matches preview and lossless export');console.log(JSON.stringify({dir,code}))
}
main().catch(e=>{console.error(e);process.exitCode=1})

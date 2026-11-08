const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createHash}=require('node:crypto')
const {spawn,execFileSync}=require('node:child_process'),{packagedExecutable}=require('../packaged-executable.cjs'),{compositionProject,videoLayer}=require('../../phase2/project.cjs')
async function main(){
 const dir=path.resolve(process.argv[3]);if(fs.existsSync(dir))throw Error('Use a fresh output directory')
 fs.mkdirSync(dir,{recursive:true});fs.mkdirSync(path.join(dir,'profile'));fs.mkdirSync(path.join(dir,'temp'))
 const audio=path.join(dir,'song.wav'),video=path.join(dir,'clip.mkv'),current=path.join(dir,'current.json'),legacy=path.join(dir,'legacy.json'),portrait=path.join(dir,'portrait.json')
 const run=args=>execFileSync('ffmpeg',['-v','error',...args],{windowsHide:true})
 run(['-f','lavfi','-i','sine=frequency=440:duration=3','-c:a','pcm_s24le',audio])
 run(['-f','lavfi','-i','color=red:s=160x90:r=30:d=1','-f','lavfi','-i','color=blue:s=160x90:r=30:d=2','-filter_complex','[0:v][1:v]concat=n=2:v=1:a=0[out]','-map','[out]','-c:v','ffv1',video])
 const project={...compositionProject(),title:'Current frame',audioRelativePath:'song.wav',layers:[{...videoLayer('video'),videoPath:undefined,videoRelativePath:'clip.mkv'}]}
 fs.writeFileSync(current,JSON.stringify(project));fs.writeFileSync(legacy,JSON.stringify({...project,title:'Existing video'}));fs.writeFileSync(portrait,JSON.stringify({...compositionProject(),width:720,height:1280,title:'Portrait artwork',audioRelativePath:'',layers:[],background:{type:'solid',color:'#346844',color2:'#000000',imagePath:'',fit:'cover'}}))
 fs.writeFileSync(path.join(dir,'profile','workflow-preferences.json'),JSON.stringify({recentProjects:[{path:legacy,name:'Existing video',lastOpened:2},{path:portrait,name:'Portrait artwork',lastOpened:1}]}))
 const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex'),before=[hash(legacy),hash(portrait),hash(video),hash(audio)]
 const fd=fs.openSync(path.join(dir,'editor.log'),'wx'),child=spawn(packagedExecutable(path.resolve(process.argv[2])),[],{env:{...process.env,PHASE2_HEADLESS:'1',PHASE2_TEST_INPUT:audio,PHASE2_TEST_PROJECT_PATH:current,PHASE5_TEST_USER_DATA:path.join(dir,'profile'),TEMP:path.join(dir,'temp'),TMP:path.join(dir,'temp'),TMPDIR:path.join(dir,'temp'),MUSICMETERS_THUMBNAIL_SMOKE:'1',MUSICMETERS_THUMBNAIL_DIR:dir},stdio:['ignore',fd,fd],windowsHide:true})
 const code=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.kill();reject(Error('Thumbnail smoke timeout'))},180000);child.once('error',reject);child.once('close',code=>{clearTimeout(timer);resolve(code)})})
 fs.closeSync(fd);assert.equal(code,0,fs.readFileSync(path.join(dir,'editor.log'),'utf8'));assert.deepEqual([hash(legacy),hash(portrait),hash(video),hash(audio)],before)
 console.log(JSON.stringify({dir,code,originalMediaAndLegacyProjects:'unchanged'}))
}
main().catch(e=>{console.error(e);process.exitCode=1})

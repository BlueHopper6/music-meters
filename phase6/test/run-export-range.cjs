const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { spawn, execFileSync } = require('node:child_process')
const { packagedExecutable } = require('../packaged-executable.cjs')
const { MediaCache } = require('../../phase2/project-media.cjs')
const run = (tool, args) => execFileSync(tool, args, { windowsHide: true, maxBuffer: 32 * 1024 * 1024 })

async function main() {
  const dir = path.resolve(process.argv[3])
  if (fs.existsSync(dir)) throw new Error('Use a fresh output directory')
  fs.mkdirSync(dir, { recursive: true }); fs.mkdirSync(path.join(dir, 'temp'))
  const audio = path.join(dir, 'tone.wav'), video = path.join(dir, 'colors.mkv')
  run('ffmpeg', ['-v','error','-f','lavfi','-i','aevalsrc=0.25*sin(2*PI*if(lt(t\\,1)\\,330\\,990)*t):s=96000:d=3','-c:a','pcm_s24le',audio])
  run('ffmpeg', ['-v','error','-f','lavfi','-i','color=red:s=160x90:r=30:d=1','-f','lavfi','-i','color=blue:s=160x90:r=30:d=2','-filter_complex','[0:v][1:v]concat=n=2:v=1:a=0[out]','-map','[out]','-c:v','ffv1',video])
  const fd = fs.openSync(path.join(dir, 'editor.log'), 'wx')
  const child = spawn(packagedExecutable(path.resolve(process.argv[2])), [], {env: {...process.env,
    TEMP:path.join(dir,'temp'),TMP:path.join(dir,'temp'),PHASE5_TEST_USER_DATA:path.join(dir,'profile'),
    PHASE2_HEADLESS:'1',PHASE2_TEST_INPUT:audio,MUSICMETERS_TEST_VIDEO:video,MUSICMETERS_RANGE_SMOKE:'1',MUSICMETERS_RANGE_DIR:dir},
    stdio:['ignore',fd,fd],windowsHide:true})
  const code = await new Promise((resolve,reject) => {
    const timer = setTimeout(() => {child.kill();reject(new Error('Range smoke timed out'))},240000)
    child.once('error',reject);child.once('close',code => {clearTimeout(timer);resolve(code)})
  })
  fs.closeSync(fd)
  assert.equal(code,0,fs.readFileSync(path.join(dir,'editor.log'),'utf8'))
  const project = JSON.parse(fs.readFileSync(path.join(dir,'project.json')))
  const cache = new MediaCache(path.join(dir,'verification-cache'))
  try {
    const expected = await cache.prepare(project,undefined,{start:1,end:1.5})
    const decode = file => run('ffmpeg',['-v','error','-i',file,'-map','0:a:0','-c:a','pcm_f32le','-f','f32le','pipe:1'])
    const samples = decode(expected.outputPath), results = []
    for (const mode of ['master','flac','aac']) {
      const file = path.join(dir,`region-${mode}.${mode === 'aac' ? 'mp4' : 'mkv'}`)
      const probe = JSON.parse(run('ffprobe',['-v','error','-count_frames','-show_streams','-show_format','-of','json',file]))
      const picture = probe.streams.find(s=>s.codec_type==='video'), audio = probe.streams.find(s=>s.codec_type==='audio')
      assert.equal(Number(picture.nb_read_frames),15)
      assert.equal(Number(audio.sample_rate),96000)
      assert.ok(Math.abs(Number(probe.format.duration)-0.5)<0.04)
      let maxError = null
      if (mode !== 'aac') {
        const actual = decode(file);assert.equal(actual.length,samples.length);maxError = 0
        for(let i=0;i<actual.length;i+=4) maxError=Math.max(maxError,Math.abs(actual.readFloatLE(i)-samples.readFloatLE(i)))
        assert.ok(maxError <= (mode === 'master' ? 0 : 3e-7))
      }
      const pixels = run('ffmpeg',['-v','error','-i',file,'-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','pipe:1'])
      assert.ok(pixels[2]>pixels[0]+100,'first picture must be the blue section at 1 second, not the red beginning')
      results.push({mode,frames:15,duration:probe.format.duration,sampleRate:audio.sample_rate,maxError})
    }
    fs.writeFileSync(path.join(dir,'verification.json'),JSON.stringify(results,null,2))
    console.log(JSON.stringify({dir,results}))
  } finally {await cache.close()}
}
main().catch(error=>{console.error(error);process.exitCode=1})

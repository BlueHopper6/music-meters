const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { spawn, spawnSync } = require('node:child_process')

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true })
  if (result.status !== 0) throw new Error(result.stderr || result.error || `${command} exited ${result.status}`)
  return result.stdout
}

async function main() {
  if (process.argv.length !== 4) throw new Error('Usage: node phase6/test/factory-designs-smoke.cjs <package-dir> <new-output-dir>')
  const pack = path.resolve(process.argv[2]), dir = path.resolve(process.argv[3])
  if (fs.existsSync(dir)) throw new Error(`Output already exists: ${dir}`)
  fs.mkdirSync(dir, { recursive: true })
  const { starter } = require(path.join(pack, 'resources', 'app', 'phase2', 'templates.cjs'))
  const audioPath = path.join(dir, 'synthetic-stereo.wav')
  // Loud, unlike stereo channels exercise the full waveform box and stereo meters.
  run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i',
    'aevalsrc=0.65*sin(2*PI*110*t)+0.25*sin(2*PI*440*t)|0.65*sin(2*PI*110*t+0.4)+0.25*sin(2*PI*880*t):s=48000:d=2.5',
    '-c:a', 'pcm_s16le', audioPath])
  const summary = []
  for (const name of ['Afterglow', 'Contour', 'Night Radio', 'Observatory']) {
    const slug = name.toLowerCase().replaceAll(' ', '-')
    const project = { ...starter(name), audioPath, title: 'Synthetic fixture' }
    assert.equal(project.layers.find(layer => layer.type === 'image').imagePath, '')
    const preset = name === 'Observatory' ? '1080p' : '720p'
    const output = path.join(dir, `${slug}.mp4`)
    const logPath = path.join(dir, `${slug}.log`)
    const log = fs.openSync(logPath, 'wx')
    const child = spawn(path.join(pack, 'electron.exe'), [], {
      env: { ...process.env, MUSICMETERS_EXPORT_PROFILE: path.join(dir, `${slug}-profile`),
        PHASE2_JOB: JSON.stringify({ project, output, preset, audioMode: 'aac', cancelFile: path.join(dir, 'never.cancel') }) },
      stdio: ['ignore', log, log], shell: false, windowsHide: true,
    })
    let code
    try {
      code = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { child.kill(); reject(new Error(`${name} export timed out`)) }, 120000)
        child.once('error', error => { clearTimeout(timer); reject(error) })
        child.once('close', result => { clearTimeout(timer); resolve(result) })
      })
    } finally { fs.closeSync(log) }
    if (code !== 0) throw new Error(`${name} export exited ${code}; see ${logPath}`)
    const probe = JSON.parse(run('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', output]))
    const video = probe.streams.find(stream => stream.codec_type === 'video')
    assert.equal(video.codec_name, 'h264')
    assert.equal(Number(video.nb_frames), 75)
    assert.deepEqual([video.width, video.height], preset === '1080p' ? [1920, 1080] : [1280, 720])
    assert.equal(probe.streams.find(stream => stream.codec_type === 'audio').codec_name, 'aac')
    run('ffmpeg', ['-v', 'error', '-xerror', '-i', output, '-f', 'null', '-'])
    const frame = path.join(dir, `${slug}.png`)
    run('ffmpeg', ['-v', 'error', '-i', output, '-vf', 'select=eq(n\\,60)', '-frames:v', '1', frame])
    assert.ok(fs.statSync(frame).size > 10000, `${name} frame looks blank`)
    summary.push({ name, preset, frames: Number(video.nb_frames), output, frame })
    console.log(`PASS: ${name} ${preset}, 75 frames, MP4/AAC, full decode, empty artwork`)
  }
  fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n')
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1 })

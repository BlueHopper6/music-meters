const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { spawn, spawnSync } = require('node:child_process')
const { defaultProject, spectrumLayer } = require('../../phase2/project.cjs')

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options })
  if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr || result.error}`)
  return result.stdout
}

async function main() {
  if (process.argv.length !== 4) throw new Error('Usage: node phase6/test/package-smoke.cjs <package-dir> <new-output-dir>')
  const pack = path.resolve(process.argv[2])
  const dir = path.resolve(process.argv[3])
  if (fs.existsSync(dir)) throw new Error(`Smoke output already exists: ${dir}`)
  fs.mkdirSync(dir, { recursive: true })
  const input = path.join(dir, 'Unicode café song 440.wav')
  run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
    'sine=frequency=440:duration=2', '-ac', '2', '-ar', '48000', '-c:a', 'pcm_s16le', input])
  const project = { ...defaultProject(), title: 'Portable smoke',
    audioRelativePath: path.basename(input), layers: [spectrumLayer()] }
  const projectPath = path.join(dir, 'new project.json')
  fs.writeFileSync(projectPath, JSON.stringify(project, null, 2))
  const output = path.join(dir, 'portable output.mp4')
  const executable = path.join(pack, 'electron.exe')
  const exportApp = path.join(pack, 'resources', 'app', 'phase2', 'export-app')
  assert.ok(fs.existsSync(executable) && fs.existsSync(exportApp), 'Portable package is incomplete')
  const cancelFile = path.join(dir, 'never.cancel')
  const logPath = path.join(dir, 'export.log')
  const log = fs.openSync(logPath, 'w')
  const child = spawn(executable, [], {
    env: { ...process.env, PHASE2_JOB: JSON.stringify({ project: { ...project,
      audioPath: input }, output, preset: '720p', cancelFile }) },
    stdio: ['ignore', log, log], shell: false, windowsHide: true,
  })
  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error('Packaged export timed out')) }, 120000)
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('close', result => { clearTimeout(timer); resolve(result) })
  })
  fs.closeSync(log)
  if (code !== 0) throw new Error(`Packaged export exited ${code}; see ${logPath}`)
  const probe = JSON.parse(run('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', output]))
  const video = probe.streams.find(stream => stream.codec_type === 'video')
  const audio = probe.streams.find(stream => stream.codec_type === 'audio')
  assert.equal(video?.codec_name, 'h264')
  assert.equal(video.width, 1280)
  assert.equal(video.height, 720)
  assert.equal(Number(video.nb_frames), 60)
  assert.equal(audio?.codec_name, 'aac')
  // Decode the entire video, sample real frame pixels, and inspect the output
  // audio's 440 Hz content. This catches broken bundles beyond MP4 metadata.
  run('ffmpeg', ['-v', 'error', '-xerror', '-i', output, '-f', 'null', '-'])
  const frame = path.join(dir, 'frame-30.png')
  run('ffmpeg', ['-v', 'error', '-i', output, '-vf', 'select=eq(n\\,30)', '-frames:v', '1', frame])
  assert.ok(fs.statSync(frame).size > 10000, 'Rendered frame appears blank or missing')
  const pcm = spawnSync('ffmpeg', ['-v', 'error', '-i', output, '-vn', '-f', 'f32le',
    '-ac', '1', '-ar', '48000', 'pipe:1'], { maxBuffer: 2 * 1024 * 1024 })
  assert.equal(pcm.status, 0)
  let sine = 0, cosine = 0, energy = 0
  const count = pcm.stdout.length / 4
  for (let i = 0; i < count; i++) {
    const sample = pcm.stdout.readFloatLE(i * 4)
    const theta = 2 * Math.PI * 440 * i / 48000
    sine += sample * Math.sin(theta)
    cosine += sample * Math.cos(theta)
    energy += sample * sample
  }
  const tone = Math.hypot(sine, cosine) * 2 / count
  assert.ok(tone > 0.025 && energy / count > 0.0001, `440 Hz audio missing: ${tone}`)
  console.log(JSON.stringify({ output, frame, logPath, frames: Number(video.nb_frames),
    audioCodec: audio.codec_name, tone440Amplitude: tone }))
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1 })

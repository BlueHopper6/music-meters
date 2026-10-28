const { packagedExecutable } = require('../../phase6/packaged-executable.cjs')
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { spawn, spawnSync } = require('node:child_process')
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options })
  assert.equal(result.status, 0, String(result.stderr || result.error))
  return result.stdout
}
async function main() {
  if (process.argv.length !== 5 || process.argv[2] !== '--package') throw new Error('Usage: node phase2/test/run-portrait-smoke.cjs --package <package-dir> <fresh-output>')
  const pack = path.resolve(process.argv[3]), dir = path.resolve(process.argv[4])
  if (fs.existsSync(dir)) throw new Error('Use a fresh output directory')
  fs.mkdirSync(dir, { recursive: true })
  const input = path.join(dir, 'portrait-tone.wav')
  run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-ac', '2', '-ar', '48000', input])
  const logPath = path.join(dir, 'editor.log'), log = fs.openSync(logPath, 'w')
  const child = spawn(packagedExecutable(pack), [], {
    env: { ...process.env, PHASE2_HEADLESS: '1', PHASE2_PORTRAIT_SMOKE: '1', PHASE2_PORTRAIT_DIR: dir,
      PHASE2_TEST_INPUT: input, PHASE2_TEST_PROJECT_PATH: path.join(dir, 'portrait.json'),
      PHASE2_TEST_OUTPUT_PATH: path.join(dir, 'portrait.mp4'), PHASE5_TEST_USER_DATA: path.join(dir, 'profile') },
    stdio: ['ignore', log, log], shell: false, windowsHide: true,
  })
  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`Portrait smoke timed out; ${logPath}`)) }, 240000)
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('close', code => { clearTimeout(timer); resolve(code) })
  })
  fs.closeSync(log)
  assert.equal(code, 0, fs.readFileSync(logPath, 'utf8'))
  for (const name of ['portrait.mp4', 'portrait-copy.mkv']) {
    const output = path.join(dir, name)
    const probe = JSON.parse(run('ffprobe', ['-v', 'error', '-count_frames', '-show_streams', '-of', 'json', output]))
    const video = probe.streams.find(stream => stream.codec_type === 'video')
    assert.deepEqual([video.width, video.height, Number(video.nb_read_frames), video.r_frame_rate], [1080, 1920, 60, '30/1'])
    assert.equal(probe.streams.find(stream => stream.codec_type === 'audio').codec_name, name.endsWith('.mkv') ? 'pcm_s16le' : 'aac')
    run('ffmpeg', ['-v', 'error', '-xerror', '-i', output, '-f', 'null', '-'])
  }
  const framePath = path.join(dir, 'export-frame-30.png')
  run('ffmpeg', ['-v', 'error', '-i', path.join(dir, 'portrait.mp4'), '-vf', 'select=eq(n\\,30)', '-frames:v', '1', framePath])
  const frame = run('ffmpeg', ['-v', 'error', '-i', framePath, '-vf', 'scale=720:1280', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1'], { encoding: null, maxBuffer: 8 * 1024 * 1024 })
  const still = run('ffmpeg', ['-v', 'error', '-i', path.join(dir, 'editor-still.png'), '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1'], { encoding: null, maxBuffer: 8 * 1024 * 1024 })
  assert.equal(still.length, 720 * 1280 * 3)
  assert.equal(frame.length, still.length)
  let difference = 0
  for (let i = 0; i < still.length; i++) difference += Math.abs(still[i] - frame[i])
  const meanDifference = difference / still.length
  assert.ok(meanDifference < 12, `Preview/export mean RGB difference ${meanDifference}`)
  console.log(JSON.stringify({ dir, dimensions: '1080x1920', framesEach: 60, meanDifference, windowAndPortraitSmoke: 'PASS' }))
}
main().catch(error => { console.error(error.stack || error); process.exitCode = 1 })

const { packagedExecutable } = require('../../phase6/packaged-executable.cjs')
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { spawn, spawnSync } = require('node:child_process')
async function main() {
  if (process.argv.length !== 4) throw new Error('Usage: node phase2/test/run-playback-smoke.cjs <package> <fresh-output>')
  const pack = path.resolve(process.argv[2]), dir = path.resolve(process.argv[3])
  if (fs.existsSync(dir)) throw new Error('Use a fresh output directory')
  fs.mkdirSync(dir, { recursive: true })
  const wav = path.join(dir, 'tone.wav')
  let input = wav
  const fixture = spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'aevalsrc=0.3*sin(2*PI*if(lt(t\\,90)\\,440\\,880)*t):s=48000:d=180', '-ac', '2', '-ar', '48000', wav], { encoding: 'utf8' })
  assert.equal(fixture.status, 0, fixture.stderr)
  const codec = process.env.PHASE2_LIVE_CODEC
  if (codec === 'mp3' || codec === 'flac') {
    input = path.join(dir, `tone.${codec}`)
    const encoded = spawnSync('ffmpeg', ['-v', 'error', '-i', wav, '-c:a', codec === 'mp3' ? 'libmp3lame' : 'flac', input], { encoding: 'utf8' })
    assert.equal(encoded.status, 0, encoded.stderr)
  }
  const logPath = path.join(dir, 'editor.log'), log = fs.openSync(logPath, 'w')
  const child = spawn(packagedExecutable(pack), [], { env: { ...process.env,
    PHASE2_HEADLESS: '1', PHASE2_PLAYBACK_SMOKE: '1', PHASE2_PLAYBACK_DIR: dir,
    PHASE2_TEST_INPUT: input, PHASE2_TEST_SAVE_PATH: path.join(dir, 'saved.json'),
    PHASE5_TEST_USER_DATA: path.join(dir, 'profile') }, stdio: ['ignore', log, log], windowsHide: true, shell: false })
  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`Playback smoke timed out: ${logPath}`)) }, 420000)
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('close', code => { clearTimeout(timer); resolve(code) })
  })
  fs.closeSync(log)
  const result = fs.readFileSync(logPath, 'utf8')
  assert.equal(code, 0, result)
  assert.ok(result.includes('"event":"playback-smoke","status":"PASS"'), result)
  assert.ok(!result.includes('Playback superseded') && !result.includes('Premature close'), 'Expected cancellation must not log errors')
  console.log(JSON.stringify({ dir, playbackSmoke: 'PASS' }))
}
main().catch(error => { console.error(error.stack || error); process.exitCode = 1 })

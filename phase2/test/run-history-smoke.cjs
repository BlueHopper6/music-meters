const fs = require('node:fs')
const path = require('node:path')
const { spawn, spawnSync } = require('node:child_process')
const { packagedExecutable } = require('../../phase6/packaged-executable.cjs')

async function main() {
  if (process.argv.length !== 4) throw new Error('Usage: node phase2/test/run-history-smoke.cjs <package> <new-output>')
  const pack = path.resolve(process.argv[2]), output = path.resolve(process.argv[3])
  if (fs.existsSync(output)) throw new Error('Output already exists')
  fs.mkdirSync(output, { recursive: true })
  const audio = path.join(output, 'song-A.wav'), secondAudio = path.join(output, 'song-B.wav')
  for (const [target, frequency] of [[audio, 440], [secondAudio, 880]]) {
    const result = spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i',
      `sine=frequency=${frequency}:duration=3`, '-ac', '2', '-ar', '48000', target], { encoding: 'utf8' })
    if (result.status !== 0) throw new Error(result.stderr || String(result.error))
  }
  const artwork = path.join(output, 'artwork.png')
  const image = spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=32x32', '-frames:v', '1', artwork], { encoding: 'utf8' })
  if (image.status !== 0) throw new Error(image.stderr || String(image.error))
  const logPath = path.join(output, 'history.log'), log = fs.openSync(logPath, 'wx')
  console.log(`History smoke output: ${output}`)
  const child = spawn(packagedExecutable(pack), [], { windowsHide: true, shell: false,
    env: { ...process.env, PHASE2_HEADLESS: '1', PHASE2_STARTUP_SMOKE: '1', PHASE2_HISTORY_SMOKE: '1',
      PHASE2_STARTUP_SMOKE_DIR: output, PHASE5_TEST_USER_DATA: path.join(output, 'user-data'),
      PHASE2_TEST_IMPORT_PATH: audio, PHASE2_HISTORY_AUDIO_B: secondAudio,
      PHASE4_TEST_IMAGE_PATH: artwork,
      PHASE2_TEST_SAVE_PATH: path.join(output, 'saved-project.json') },
    stdio: ['ignore', log, log] })
  try {
    const code = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { child.kill(); reject(new Error(`History smoke timed out; see ${logPath}`)) }, 180000)
      child.once('error', error => { clearTimeout(timer); reject(error) })
      child.once('close', value => { clearTimeout(timer); resolve(value) })
    })
    const contents = fs.readFileSync(logPath, 'utf8')
    console.log(contents)
    if (code !== 0 || !contents.includes('"event":"history-smoke","status":"PASS"')) throw new Error(`History smoke failed (${code}); see ${logPath}`)
  } finally { fs.closeSync(log) }
}
main().catch(error => { console.error(error.stack || error); process.exitCode = 1 })

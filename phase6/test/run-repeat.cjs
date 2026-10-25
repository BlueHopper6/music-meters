const fs = require('node:fs')
const path = require('node:path')
const { spawn, spawnSync } = require('node:child_process')
const { build } = require('../../phase2/build.cjs')

async function main() {
  if (process.argv.length !== 3) throw new Error('Usage: node phase6/test/run-repeat.cjs <new-output-dir>')
  const dir = path.resolve(process.argv[2])
  if (fs.existsSync(dir)) throw new Error(`Output already exists: ${dir}`)
  fs.mkdirSync(dir, { recursive: true })
  const input = path.join(dir, 'repeat-song.wav')
  const fixture = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
    'sine=frequency=660:duration=2', '-ac', '2', '-ar', '48000', input], { encoding: 'utf8' })
  if (fixture.status !== 0) throw new Error(fixture.stderr)
  const electron = await build()
  const logPath = path.join(dir, 'editor.log')
  const log = fs.openSync(logPath, 'w')
  const child = spawn(electron, [path.resolve(__dirname, '..', '..', 'phase2', 'editor-app')], {
    env: { ...process.env, PHASE2_HEADLESS: '1', PHASE6_REPEAT_SMOKE: '1',
      PHASE6_REPEAT_DIR: dir, PHASE2_TEST_INPUT: input,
      PHASE2_TEST_OUTPUT_PATH: path.join(dir, 'first-export.mp4'),
      PHASE5_TEST_USER_DATA: path.join(dir, 'user-data') },
    stdio: ['ignore', log, log], shell: false, windowsHide: true,
  })
  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error('Repeat editor smoke timed out')) }, 240000)
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('close', result => { clearTimeout(timer); resolve(result) })
  })
  fs.closeSync(log)
  if (code !== 0) throw new Error(`Repeat editor smoke exited ${code}; see ${logPath}`)
  for (const name of ['first-export.mp4', 'second-export.mp4']) {
    const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=nb_frames',
      '-select_streams', 'v:0', '-of', 'default=nw=1:nk=1', path.join(dir, name)], { encoding: 'utf8' })
    if (probe.status !== 0 || Number(probe.stdout.trim()) !== 60) throw new Error(`Invalid ${name}: ${probe.stderr}`)
  }
  console.log(JSON.stringify({ dir, logPath, exports: 2, framesEach: 60 }))
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1 })

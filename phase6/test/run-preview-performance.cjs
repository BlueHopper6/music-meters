const fs = require('node:fs')
const path = require('node:path')
const { spawn, spawnSync } = require('node:child_process')

async function main() {
  if (process.argv.length !== 4) throw new Error('Usage: node phase6/test/run-preview-performance.cjs <package-dir> <new-output-dir>')
  const packaged = path.resolve(process.argv[2])
  const dir = path.resolve(process.argv[3])
  if (fs.existsSync(dir)) throw new Error(`Output already exists: ${dir}`)
  fs.mkdirSync(dir, { recursive: true })
  const input = path.join(dir, 'late-song.wav')
  const fixture = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
    'sine=frequency=440:duration=120', '-ac', '2', '-ar', '48000', input], { encoding: 'utf8' })
  if (fixture.status !== 0) throw new Error(fixture.stderr)
  const logPath = path.join(dir, 'editor.log')
  const log = fs.openSync(logPath, 'w')
  const child = spawn(path.join(packaged, 'electron.exe'), [], {
    env: { ...process.env, PHASE2_HEADLESS: '1', PHASE2_TEST_INPUT: input,
      PHASE6_PREVIEW_PERF_SMOKE: '1', PHASE6_PREVIEW_PERF_DIR: dir,
      PHASE5_TEST_USER_DATA: path.join(dir, 'user-data') },
    stdio: ['ignore', log, log], shell: false, windowsHide: true,
  })
  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error('Preview performance smoke timed out')) }, 180000)
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('close', result => { clearTimeout(timer); resolve(result) })
  })
  fs.closeSync(log)
  if (code !== 0) throw new Error(`Preview performance smoke exited ${code}; see ${logPath}`)
  console.log(fs.readFileSync(path.join(dir, 'summary.json'), 'utf8').trim())
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1 })

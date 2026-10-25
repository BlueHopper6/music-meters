const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { spawn, spawnSync } = require('node:child_process')
const { createHash } = require('node:crypto')

function run(command, args) {
  const result = spawnSync(command, args, { maxBuffer: 16 * 1024 * 1024 })
  assert.equal(result.status, 0, `${command}: ${result.stderr.toString() || result.error}`)
  return result.stdout
}

async function main() {
  if (process.argv.length !== 4) throw new Error('Usage: node phase6/test/run-audio-copy-editor.cjs <package-dir> <new-output-dir>')
  const executable = path.join(path.resolve(process.argv[2]), 'electron.exe')
  const dir = path.resolve(process.argv[3])
  if (fs.existsSync(dir)) throw new Error(`Output already exists: ${dir}`)
  fs.mkdirSync(dir, { recursive: true })
  const input = path.join(dir, 'Song ° [alt].flac')
  run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
    'sine=frequency=660:duration=1.5', '-ac', '2', '-ar', '48000', '-c:a', 'flac', input])
  const first = path.join(dir, 'Editor copy one.mkv')
  const logPath = path.join(dir, 'editor.log')
  const log = fs.openSync(logPath, 'w')
  const child = spawn(executable, [], { env: { ...process.env,
    PHASE2_HEADLESS: '1', PHASE2_TEST_INPUT: input,
    PHASE6_AUDIO_COPY_EDITOR_SMOKE: '1', PHASE6_AUDIO_COPY_EDITOR_DIR: dir,
    PHASE5_TEST_USER_DATA: path.join(dir, 'user-data'),
  }, stdio: ['ignore', log, log], shell: false, windowsHide: true })
  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error('Audio copy editor timed out')) }, 180000)
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('close', value => { clearTimeout(timer); resolve(value) })
  })
  fs.closeSync(log)
  assert.equal(code, 0, `Editor failed: ${fs.readFileSync(logPath, 'utf8')}`)
  const packetHash = file => createHash('sha256').update(run('ffmpeg', [
    '-v', 'error', '-i', file, '-map', '0:a:0', '-c:a', 'copy', '-f', 'data', 'pipe:1',
  ])).digest('hex')
  for (const output of [first, path.join(dir, 'Editor copy two.mkv')]) {
    assert.equal(packetHash(output), packetHash(input))
    run('ffmpeg', ['-v', 'error', '-xerror', '-i', output, '-f', 'null', '-'])
  }
  console.log(JSON.stringify({ dir, exports: 2, codec: 'flac', packetHash: packetHash(input) }))
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1 })

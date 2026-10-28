const { packagedExecutable } = require('../packaged-executable.cjs')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { spawn, spawnSync } = require('node:child_process')
const { defaultProject, spectrumLayer } = require('../../phase2/project.cjs')

async function main() {
  if (process.argv.length !== 4) throw new Error('Usage: node phase6/test/encoder-failure.cjs <package-dir> <new-output-dir>')
  const executable = packagedExecutable(path.resolve(process.argv[2]))
  const dir = path.resolve(process.argv[3])
  if (fs.existsSync(dir)) throw new Error(`Output already exists: ${dir}`)
  fs.mkdirSync(dir, { recursive: true })
  const input = path.join(dir, 'source.wav')
  const fixture = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
    'sine=frequency=440:duration=1', '-ac', '2', '-ar', '48000', input], { encoding: 'utf8' })
  assert.equal(fixture.status, 0, fixture.stderr)
  const output = path.join(dir, 'failed.mp4')
  const project = { ...defaultProject(), title: 'Encoder failure', audioPath: input,
    layers: [spectrumLayer()] }
  const logPath = path.join(dir, 'export.log')
  const log = fs.openSync(logPath, 'w')
  // Node rejects FFmpeg's arguments immediately. This checks the real child
  // failure and partial-file cleanup without touching system FFmpeg or disk.
  const child = spawn(executable, [], { env: { ...process.env,
    PHASE6_TEST_ENCODER: process.execPath,
    PHASE2_JOB: JSON.stringify({ project, output, preset: '720p',
      cancelFile: path.join(dir, 'never.cancel') }) },
    stdio: ['ignore', log, log], shell: false, windowsHide: true })
  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error('Encoder failure test timed out')) }, 60000)
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('close', value => { clearTimeout(timer); resolve(value) })
  })
  fs.closeSync(log)
  const text = fs.readFileSync(logPath, 'utf8')
  assert.notEqual(code, 0)
  assert.match(text, /Video encoder exited|Encoder input closed|Encoder exited/)
  assert.ok(!fs.existsSync(output))
  assert.equal(fs.readdirSync(dir).filter(name => name.startsWith('failed.mp4.partial-')).length, 0)
  console.log(JSON.stringify({ logPath, output, exit: code, partialFiles: 0 }))
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1 })

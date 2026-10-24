const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { build } = require('../../phase2/build.cjs')

const ROOT = path.resolve(__dirname, '..', '..')
async function main() {
  const dir = path.resolve(process.argv[2])
  const source = path.join(ROOT, 'artifacts', 'phase3', 'vectorscope', 'all-eight.json')
  const stored = JSON.parse(fs.readFileSync(source, 'utf8'))
  const audio = path.resolve(path.dirname(source), stored.audioRelativePath)
  const target = path.join(dir, 'legacy-v1.json')
  fs.writeFileSync(target, JSON.stringify({ ...stored, audioRelativePath: path.relative(dir, audio).replaceAll('\\', '/') }, null, 2) + '\n', { flag: 'wx' })
  const electron = await build()
  const log = fs.openSync(path.join(dir, 'legacy.log'), 'w')
  const child = spawn(electron, [path.join(ROOT, 'phase2', 'editor-app')], {
    env: { ...process.env, PHASE2_HEADLESS: '1', PHASE4_LEGACY_SMOKE: '1',
      PHASE2_TEST_INPUT: audio, PHASE2_TEST_PROJECT_PATH: target, PHASE4_GATE_DIR: dir },
    stdio: ['ignore', log, log], shell: false, windowsHide: true,
  })
  const code = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { child.kill(); reject(new Error('Legacy editor smoke timed out')) }, 300000)
    child.once('error', error => { clearTimeout(timeout); reject(error) })
    child.once('close', result => { clearTimeout(timeout); resolve(result) })
  })
  fs.closeSync(log)
  if (code !== 0) throw new Error(`Legacy editor smoke failed (exit ${code}); see legacy.log`)
  console.log(target)
}
main().catch(error => { console.error(error.stack || error); process.exitCode = 1 })

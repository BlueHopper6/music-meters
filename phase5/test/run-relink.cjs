const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { build } = require('../../phase2/build.cjs')

async function main() {
  const gate = path.resolve(process.argv[2])
  const root = path.resolve(__dirname, '..', '..')
  const dir = path.join(gate, `relink-${Date.now()}`)
  fs.mkdirSync(dir)
  const project = path.join(dir, 'song-B-project.json')
  fs.copyFileSync(path.join(gate, 'song-B-project.json'), project)
  const electron = await build()
  const logPath = path.join(dir, 'relink.log')
  const log = fs.openSync(logPath, 'w')
  const child = spawn(electron, [path.join(root, 'phase2', 'editor-app')], {
    env: { ...process.env, PHASE2_HEADLESS: '1', PHASE5_RELINK_SMOKE: '1', PHASE5_GATE_DIR: dir,
      PHASE5_TEST_USER_DATA: path.join(gate, 'user-data'), PHASE2_TEST_PROJECT_PATH: project,
      PHASE2_TEST_IMPORT_PATH: path.join(gate, 'song-B-880.wav'),
      PHASE4_TEST_IMAGE_PATH: path.join(gate, 'art-B.png') },
    stdio: ['ignore', log, log], shell: false, windowsHide: true,
  })
  const code = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { child.kill(); reject(new Error('Relink test timed out')) }, 120000)
    child.once('error', error => { clearTimeout(timeout); reject(error) })
    child.once('close', result => { clearTimeout(timeout); resolve(result) })
  })
  fs.closeSync(log)
  console.log(dir)
  if (code !== 0) throw new Error(`Relink smoke failed (exit ${code}); see ${logPath}`)
}
main().catch(error => { console.error(error.stack || error); process.exitCode = 1 })

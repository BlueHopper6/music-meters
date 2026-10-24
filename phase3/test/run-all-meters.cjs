const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { build } = require('../../phase2/build.cjs')

async function main() {
  const root = path.resolve(__dirname, '..', '..')
  const dest = path.join(root, 'artifacts', 'phase3', 'vectorscope')
  fs.mkdirSync(dest, { recursive: true })
  const output = path.join(dest, 'all-eight.mp4')
  if (fs.existsSync(output)) throw new Error(`Output already exists: ${output}`)
  const log = fs.openSync(path.join(dest, 'all-meters.log'), 'w')
  const electron = await build()
  const child = spawn(electron, [path.join(root, 'phase2', 'editor-app')], {
    env: { ...process.env, PHASE2_HEADLESS: '1', PHASE3_ALL_METERS_SMOKE: '1',
      PHASE2_TEST_INPUT: path.join(root, 'artifacts', 'phase3', 'spectrum-10s-48k.wav'),
      PHASE2_TEST_PROJECT_PATH: path.join(dest, 'all-eight.json'),
      PHASE2_TEST_OUTPUT_PATH: output },
    stdio: ['ignore', log, log], shell: false, windowsHide: true,
  })
  const code = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { child.kill(); reject(new Error('All-eight smoke timed out')) }, 300000)
    child.once('error', error => { clearTimeout(timeout); reject(error) })
    child.once('close', result => { clearTimeout(timeout); resolve(result) })
  })
  fs.closeSync(log)
  if (code !== 0 || !fs.existsSync(output)) throw new Error(`All-eight smoke failed (exit ${code})`)
  console.log(JSON.stringify({ status: 'PASS', output, bytes: fs.statSync(output).size }))
}
main().catch(error => { console.error(error.stack || error); process.exitCode = 1 })

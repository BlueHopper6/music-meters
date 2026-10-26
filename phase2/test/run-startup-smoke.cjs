const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { build } = require('../build.cjs')

const root = path.resolve(__dirname, '..', '..')

async function main() {
  const electron = await build()
  const runId = `startup-smoke-${Date.now()}`
  const outDir = path.join(root, 'artifacts', 'phase2', runId)
  fs.mkdirSync(outDir, { recursive: true })

  const userData = path.join(outDir, 'user-data')
  fs.mkdirSync(userData, { recursive: true })

  const savePath = path.join(outDir, 'saved-smoke-project.json')
  const logPath = path.join(outDir, 'electron.log')
  const log = fs.openSync(logPath, 'w')

  console.log(`Starting startup smoke test in: ${outDir}`)

  const child = spawn(electron, [path.join(root, 'phase2', 'editor-app')], {
    env: {
      ...process.env,
      PHASE2_HEADLESS: '1',
      PHASE2_STARTUP_SMOKE: '1',
      PHASE5_TEST_USER_DATA: userData,
      PHASE2_TEST_SAVE_PATH: savePath,
    },
    stdio: ['ignore', log, log],
    shell: false,
    windowsHide: true,
  })

  const code = await new Promise((resolveCode, reject) => {
    child.once('error', reject)
    child.once('close', resolveCode)
  })

  const logContent = fs.readFileSync(logPath, 'utf8')
  console.log(logContent)

  if (code !== 0) {
    throw new Error(`Startup smoke test failed with exit code ${code}`)
  }
  console.log('PASS: Startup splash and Project Manager smoke test passed cleanly!')
}

main().catch(error => {
  console.error(error.stack || error)
  process.exit(1)
})

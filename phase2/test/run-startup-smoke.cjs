const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { build } = require('../build.cjs')

const root = path.resolve(__dirname, '..', '..')

async function main() {
  const packaged = process.argv[2] === '--package' && process.argv.length === 4
  if (process.argv.length !== 2 && !packaged) {
    throw new Error('Usage: node phase2/test/run-startup-smoke.cjs [--package <portable-directory>]')
  }
  const electron = packaged ? path.join(path.resolve(process.argv[3]), 'electron.exe') : await build()
  if (packaged && !fs.existsSync(electron)) throw new Error(`Portable executable not found: ${electron}`)
  const args = packaged ? [] : [path.join(root, 'phase2', 'editor-app')]
  const runId = `startup-smoke-${Date.now()}`
  const outDir = path.join(root, 'artifacts', 'phase2', runId)
  fs.mkdirSync(outDir, { recursive: true })

  const userData = path.join(outDir, 'user-data')
  fs.mkdirSync(userData, { recursive: true })

  const savePath = path.join(outDir, 'saved-smoke-project.json')
  const logPath = path.join(outDir, 'electron.log')
  const log = fs.openSync(logPath, 'w')

  console.log(`Starting startup smoke test in: ${outDir}`)

  const child = spawn(electron, args, {
    env: {
      ...process.env,
      PHASE2_HEADLESS: '1',
      PHASE2_STARTUP_SMOKE: '1',
      PHASE2_STARTUP_SMOKE_DIR: outDir,
      PHASE5_TEST_USER_DATA: userData,
      PHASE2_TEST_SAVE_PATH: savePath,
    },
    stdio: ['ignore', log, log],
    shell: false,
    windowsHide: true,
  })

  const code = await new Promise((resolveCode, reject) => {
    const timeout = setTimeout(() => {
      child.kill()
      reject(new Error(`Startup smoke timed out; see ${logPath}`))
    }, 120000)
    child.once('error', error => { clearTimeout(timeout); reject(error) })
    child.once('close', result => { clearTimeout(timeout); resolveCode(result) })
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

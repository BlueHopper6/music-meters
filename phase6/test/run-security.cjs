const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')

async function main() {
  if (process.argv.length !== 4) throw new Error('Usage: node phase6/test/run-security.cjs <package-dir> <new-output-dir>')
  const packageDir = path.resolve(process.argv[2])
  const dir = path.resolve(process.argv[3])
  if (fs.existsSync(dir)) throw new Error(`Output already exists: ${dir}`)
  fs.mkdirSync(dir, { recursive: true })
  const logPath = path.join(dir, 'security.log')
  const log = fs.openSync(logPath, 'w')
  const child = spawn(path.join(packageDir, 'electron.exe'), [], {
    env: { ...process.env, PHASE2_HEADLESS: '1', PHASE6_SECURITY_SMOKE: '1',
      PHASE5_TEST_USER_DATA: path.join(dir, 'user-data') },
    stdio: ['ignore', log, log], shell: false, windowsHide: true,
  })
  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error('Security smoke timed out')) }, 30000)
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('close', result => { clearTimeout(timer); resolve(result) })
  })
  fs.closeSync(log)
  if (code !== 0) throw new Error(`Security smoke exited ${code}; see ${logPath}`)
  console.log(fs.readFileSync(logPath, 'utf8').trim())
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1 })

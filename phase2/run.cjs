const { spawn } = require('node:child_process')
const { resolve, join } = require('node:path')
const { build } = require('./build.cjs')

async function main() {
  if (process.argv.length > 2 && (process.argv.length !== 4 || process.argv[2] !== '--audio')) {
    throw new Error('Usage: node phase2/run.cjs [--audio <WAV|MP3|FLAC>]')
  }
  const electron = await build()
  const env = { ...process.env }
  if (process.argv[2] === '--audio') env.PHASE2_TEST_INPUT = resolve(process.argv[3])
  const child = spawn(electron, [join(__dirname, 'editor-app')], {
    env, stdio: 'inherit', shell: false, windowsHide: false,
  })
  process.exitCode = await new Promise((resolveCode, reject) => {
    child.once('error', reject)
    child.once('close', resolveCode)
  }) ?? 1
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })

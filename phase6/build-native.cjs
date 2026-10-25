const { spawnSync, execFileSync } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')

const root = path.resolve(__dirname, '..')
const options = process.argv.slice(2)
if (options.length !== 0 && (options.length !== 2 || options[0] !== '--prism-dir')) {
  throw new Error('Usage: node phase6/build-native.cjs [--prism-dir <pinned-prism-directory>]')
}
const prism = options.length ? path.resolve(options[1]) : path.join(root, 'upstream', 'prism')
const pin = '49721802252b115d169e353c98b27408daa5e2b7'
const marker = path.join(prism, '.musicmeters-prism-commit')
const revision = fs.existsSync(marker) ? fs.readFileSync(marker, 'utf8').trim()
  : execFileSync('git', ['rev-parse', 'HEAD'], { cwd: prism, encoding: 'utf8' }).trim()
if (revision !== pin) throw new Error(`Prism must be checked out at ${pin}`)
const tools = path.join(__dirname, 'build-tools', 'node_modules')
const executable = path.join(tools, 'node-gyp', 'bin', 'node-gyp.js')
if (!fs.existsSync(executable)) throw new Error('Install phase6/build-tools with npm ci first')
const args = [executable, 'rebuild']
const result = spawnSync(process.execPath, args, {
  cwd: path.join(prism, 'native'),
  env: { ...process.env, NODE_PATH: [tools, process.env.NODE_PATH].filter(Boolean).join(path.delimiter) },
  stdio: 'inherit', shell: false,
})
if (result.error) console.error(`Could not start native build: ${result.error.message}`)
process.exitCode = result.status ?? 1

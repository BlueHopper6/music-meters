const { spawnSync, execFileSync } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

const root = path.resolve(__dirname, '..')
const pin = '49721802252b115d169e353c98b27408daa5e2b7'

function safeRealpath(target) {
  try { return fs.realpathSync(target) } catch { return path.resolve(target) }
}

function darwinCompileFlags(sourceRoot = root, prismRoot = path.join(sourceRoot, 'upstream', 'prism')) {
  const toolsRoot = path.join(sourceRoot, 'phase6', 'build-tools', 'node_modules')
  const candidates = [
    prismRoot,
    safeRealpath(prismRoot),
    toolsRoot,
    safeRealpath(toolsRoot),
    sourceRoot,
    safeRealpath(sourceRoot),
    os.homedir(),
  ]
  const seen = new Set()
  const flags = []
  for (const dir of candidates) {
    if (!dir || seen.has(dir) || /\s/.test(dir)) continue
    seen.add(dir)
    flags.push(`-ffile-prefix-map=${dir}=.`, `-fdebug-prefix-map=${dir}=.`, `-fmacro-prefix-map=${dir}=.`)
  }
  return flags.join(' ')
}

function scanBinaryPrivacy(binaryPath, extraMarkers = []) {
  const bytes = fs.readFileSync(binaryPath)
  const ascii = bytes.toString('latin1')
  const utf16 = bytes.toString('utf16le')
  const markers = [
    '/Users/',
    '/private/var/folders/',
    '/var/folders/',
    'C:\\Users\\',
    'c:\\users\\',
    ...extraMarkers.filter(Boolean),
  ]
  for (const marker of markers) {
    if (ascii.includes(marker) || utf16.includes(marker)) {
      throw new Error(`Native binary privacy check failed (${marker} found in ${path.basename(binaryPath)})`)
    }
  }
  return true
}

function runNativeBuild(argv = process.argv.slice(2)) {
  if (argv.length !== 0 && (argv.length !== 2 || argv[0] !== '--prism-dir')) {
    throw new Error('Usage: node phase6/build-native.cjs [--prism-dir <pinned-prism-directory>]')
  }
  const prism = argv.length ? path.resolve(argv[1]) : path.join(root, 'upstream', 'prism')
  const marker = path.join(prism, '.musicmeters-prism-commit')
  const revision = fs.existsSync(marker) ? fs.readFileSync(marker, 'utf8').trim()
    : execFileSync('git', ['rev-parse', 'HEAD'], { cwd: prism, encoding: 'utf8' }).trim()
  if (revision !== pin) throw new Error(`Prism must be checked out at ${pin}`)
  const tools = path.join(__dirname, 'build-tools', 'node_modules')
  const executable = path.join(tools, 'node-gyp', 'bin', 'node-gyp.js')
  if (!fs.existsSync(executable)) throw new Error('Install phase6/build-tools with npm ci first')
  const env = {
    ...process.env,
    NODE_PATH: [tools, process.env.NODE_PATH].filter(Boolean).join(path.delimiter),
  }
  if (process.platform === 'darwin') {
    const remap = darwinCompileFlags(root, prism)
    env.CFLAGS = [process.env.CFLAGS, remap].filter(Boolean).join(' ')
    env.CXXFLAGS = [process.env.CXXFLAGS, remap].filter(Boolean).join(' ')
  }
  const result = spawnSync(process.execPath, [executable, 'rebuild'], {
    cwd: path.join(prism, 'native'),
    env,
    stdio: 'inherit',
    shell: false,
  })
  if (result.error) {
    console.error(`Could not start native build: ${result.error.message}`)
    process.exitCode = result.status ?? 1
    return
  }
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1
    return
  }
  if (process.platform === 'darwin') {
    const addon = path.join(prism, 'native', 'build', 'Release', 'visualizer_dsp.node')
    const strip = spawnSync('strip', ['-x', addon], { stdio: 'inherit', shell: false })
    if (strip.status !== 0) {
      throw new Error('Failed to strip local symbols from macOS native addon')
    }
    scanBinaryPrivacy(addon, [root, safeRealpath(root), prism, safeRealpath(prism), os.homedir()])
  }
  process.exitCode = 0
}

if (require.main === module) {
  runNativeBuild()
}

module.exports = { pin, darwinCompileFlags, scanBinaryPrivacy, runNativeBuild }

const { spawn, execFileSync } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')
const crypto = require('node:crypto')
const { verifyElectronRuntime } = require('../phase6/electron-runtime.cjs')

const ROOT = path.resolve(__dirname, '..')
const PRISM = path.join(ROOT, 'upstream', 'prism')
const PIN = '49721802252b115d169e353c98b27408daa5e2b7'
const PRESETS = { '720p': [1280, 720], '1080p': [1920, 1080] }

function parse(args) {
  const options = {}
  for (let i = 0; i < args.length; i++) {
    const key = args[i]
    if (!['--input', '--output', '--preset', '--title', '--cancel-after-frames'].includes(key)) {
      throw new Error(`Unknown option: ${key}`)
    }
    if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Missing value for ${key}`)
    options[key.slice(2)] = args[++i]
  }
  if (!options.input || !options.output) {
    throw new Error('Usage: node phase1/export.cjs --input <WAV|MP3|FLAC> --output <MP4> [--preset 720p|1080p] [--title text]')
  }
  options.preset ||= '720p'
  if (!PRESETS[options.preset]) throw new Error(`Unsupported preset: ${options.preset}`)
  if (path.extname(options.output).toLowerCase() !== '.mp4') throw new Error('Output must end in .mp4')
  if (options['cancel-after-frames'] !== undefined) {
    const number = Number(options['cancel-after-frames'])
    if (!Number.isSafeInteger(number) || number < 1) throw new Error('Cancellation frame must be a positive integer')
    options.cancelAfterFrames = number
  }
  options.input = path.resolve(options.input)
  options.output = path.resolve(options.output)
  if (options.input === options.output) throw new Error('Input and output paths must differ')
  if (!['.wav', '.mp3', '.flac'].includes(path.extname(options.input).toLowerCase())) {
    throw new Error('Input must be WAV, MP3, or FLAC')
  }
  let stat
  try {
    stat = fs.statSync(options.input)
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`Input does not exist: ${options.input}`)
    throw error
  }
  if (!stat.isFile()) throw new Error('Input is not a regular file')
  if (fs.existsSync(options.output)) throw new Error(`Output already exists: ${options.output}`)
  options.title ||= path.parse(options.input).name
  if (options.title.length > 200) throw new Error('Title is too long')
  options.width = PRESETS[options.preset][0]
  options.height = PRESETS[options.preset][1]
  return options
}

function checkPrerequisites() {
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: PRISM, encoding: 'utf8' }).trim()
  if (commit !== PIN) throw new Error(`Prism must be checked out at ${PIN}`)
  for (const required of [
    path.join(PRISM, 'native', 'build', 'Release', 'visualizer_dsp.node'),
  ]) {
    if (!fs.existsSync(required)) throw new Error(`Missing prerequisite: ${required}`)
  }
  verifyElectronRuntime()
  execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' })
  execFileSync('ffprobe', ['-version'], { stdio: 'ignore' })
}

async function buildRenderer() {
  const esbuild = require(path.join(PRISM, 'node_modules', 'esbuild'))
  const entry = path.join(__dirname, 'renderer.ts')
  const target = path.join(PRISM, 'src', 'renderer', 'visualizers', 'Vectorscope.ts')
  const marker = '  private drawFrame = (): void => {'
  const output = path.join(ROOT, 'artifacts', 'phase1', 'renderer.js')
  fs.mkdirSync(path.dirname(output), { recursive: true })
  await esbuild.build({
    entryPoints: [entry], outfile: output, bundle: true, platform: 'browser',
    format: 'iife', target: 'chrome120',
    plugins: [{
      name: 'explicit-vectorscope-frame',
      setup(build) {
        build.onLoad({ filter: /Vectorscope\.ts$/ }, args => {
          if (path.resolve(args.path) !== target) return null
          const source = fs.readFileSync(args.path, 'utf8')
          if (source.split(marker).length !== 2) throw new Error('Pinned Prism frame seam changed')
          const contents = source.replace(marker, `  renderFrame(): void { this.drawFrame() }\n\n${marker}`)
          return { contents, loader: 'ts', resolveDir: path.dirname(args.path) }
        })
      },
    }],
  })
}

async function main() {
  const options = parse(process.argv.slice(2))
  checkPrerequisites()
  await buildRenderer()
  const controlDir = path.join(ROOT, 'artifacts', 'phase1', 'jobs')
  fs.mkdirSync(controlDir, { recursive: true })
  const cancelFile = path.join(controlDir, `${crypto.randomUUID()}.cancel`)
  const env = {
    ...process.env,
    PHASE1_JOB: JSON.stringify({ ...options, cancelFile }),
  }
  const electron = verifyElectronRuntime()
  const child = spawn(electron, [path.join(__dirname, 'electron-app')], {
    env, stdio: 'inherit', shell: false, detached: true, windowsHide: true,
  })
  let requested = false
  process.on('SIGINT', () => {
    if (requested) return
    requested = true
    fs.writeFileSync(cancelFile, 'cancel')
    console.error('Cancellation requested; waiting for export cleanup...')
  })
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', resolve)
  })
  fs.rmSync(cancelFile, { force: true })
  process.exitCode = code ?? 1
}

main().catch(error => { console.error(error.message); process.exitCode = 1 })

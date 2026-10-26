const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { randomUUID } = require('node:crypto')
const { build } = require('./build.cjs')
const { normalizeProject } = require('./project.cjs')
const { assertInstalledFonts } = require('./fonts.cjs')
const { resolveArtwork } = require('./assets.cjs')
const { jobPath } = require('./runtime.cjs')
const { validateOutputPath } = require('./audio-output.cjs')

function parse(args) {
  const options = {}
  for (let i = 0; i < args.length; i += 2) {
    if (!['--project', '--output', '--preset', '--audio-mode', '--cancel-after-frames'].includes(args[i]) || !args[i + 1]) {
      throw new Error('Usage: node phase2/export.cjs --project <JSON> --output <MP4|MKV> [--audio-mode aac|copy] [--preset 720p|1080p]')
    }
    options[args[i].slice(2)] = args[i + 1]
  }
  if (!options.project || !options.output) throw new Error('Project and output paths are required')
  options.project = path.resolve(options.project)
  options.output = path.resolve(options.output)
  options.preset ||= '720p'
  options['audio-mode'] ||= 'aac'
  if (!['720p', '1080p'].includes(options.preset)) throw new Error('Unsupported export preset')
  validateOutputPath(options.output, options['audio-mode'])
  if (fs.existsSync(options.output)) throw new Error(`Output already exists: ${options.output}`)
  if (options['cancel-after-frames'] !== undefined) {
    const frame = Number(options['cancel-after-frames'])
    if (!Number.isSafeInteger(frame) || frame < 1) throw new Error('Cancellation frame must be positive')
    options.cancelAfterFrames = frame
  }
  return options
}

async function main() {
  const options = parse(process.argv.slice(2))
  if (fs.statSync(options.project).size > 1024 * 1024) throw new Error('Project file is too large')
  const document = JSON.parse(fs.readFileSync(options.project, 'utf8'))
  if (typeof document.audioRelativePath !== 'string' || path.isAbsolute(document.audioRelativePath)) {
    throw new Error('Project audio reference is invalid')
  }
  const audioPath = document.audioRelativePath
    ? path.resolve(path.dirname(options.project), document.audioRelativePath) : ''
  const project = normalizeProject(resolveArtwork({ ...document, audioPath }, options.project))
  assertInstalledFonts(project)
  if (!audioPath || !fs.statSync(audioPath).isFile()) throw new Error('Project audio is unavailable')
  const electron = await build()
  const controlDir = jobPath('jobs')
  fs.mkdirSync(controlDir, { recursive: true })
  const cancelFile = path.join(controlDir, `${randomUUID()}.cancel`)
  const exportProfile = fs.mkdtempSync(path.join(controlDir, 'export-profile-'))
  const child = spawn(electron, [path.join(__dirname, 'export-app')], {
    env: { ...process.env, MUSICMETERS_EXPORT_PROFILE: exportProfile,
      PHASE2_JOB: JSON.stringify({ project, output: options.output,
      preset: options.preset, audioMode: options['audio-mode'],
      cancelFile, cancelAfterFrames: options.cancelAfterFrames }) },
    stdio: 'inherit', shell: false, detached: true, windowsHide: true,
  })
  process.on('SIGINT', () => {
    fs.writeFileSync(cancelFile, 'cancel')
    console.error('Cancellation requested; waiting for cleanup...')
  })
  let code
  try {
    code = await new Promise((resolveCode, reject) => {
      child.once('error', reject)
      child.once('close', resolveCode)
    })
  } finally {
    fs.rmSync(cancelFile, { force: true })
    try { await fs.promises.rm(exportProfile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) }
    catch (error) { console.error(`Could not remove temporary exporter profile: ${error.message}`) }
  }
  process.exitCode = code ?? 1
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })

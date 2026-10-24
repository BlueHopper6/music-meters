const { spawn, execFileSync } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')

const root = path.resolve(__dirname, '..')
const prism = path.join(root, 'upstream', 'prism')
const artifacts = path.join(root, 'artifacts', 'phase0')
const output = path.resolve(process.argv[2] || path.join(artifacts, 'stereo-phases.mp4'))
const addon = path.join(prism, 'native', 'build', 'Release', 'visualizer_dsp.node')
const electron = path.join(prism, 'node_modules', 'electron', 'dist', 'electron.exe')
const pinnedPrismCommit = '49721802252b115d169e353c98b27408daa5e2b7'
if (execFileSync('git', ['rev-parse', 'HEAD'], { cwd: prism, encoding: 'utf8' }).trim() !== pinnedPrismCommit) {
  throw new Error(`Prism must be checked out at ${pinnedPrismCommit}`)
}
for (const required of [addon, electron, path.join(artifacts, 'stereo-phases.wav')]) {
  if (!fs.existsSync(required)) throw new Error(`Missing prerequisite: ${required}`)
}
if (fs.existsSync(output)) throw new Error(`Output already exists: ${output}`)
fs.mkdirSync(artifacts, { recursive: true })
const esbuild = require(path.join(prism, 'node_modules', 'esbuild'))
esbuild.buildSync({
  entryPoints: [path.join(__dirname, 'renderer.ts')],
  outfile: path.join(artifacts, 'renderer.js'),
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'chrome120',
})
const child = spawn(electron, [path.join(__dirname, 'electron-app')], {
  env: {
    ...process.env,
    PHASE0_OUTPUT: output,
    PHASE0_FIXTURE: path.join(artifacts, 'stereo-phases.wav'),
    PHASE0_FFMPEG: 'ffmpeg',
  },
  stdio: 'inherit',
  shell: false,
})
child.on('exit', code => { process.exitCode = code ?? 1 })
child.on('error', error => { console.error(error); process.exitCode = 1 })

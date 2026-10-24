const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const ROOT = path.resolve(__dirname, '..')
const PRISM = path.join(ROOT, 'upstream', 'prism')
const PIN = '49721802252b115d169e353c98b27408daa5e2b7'

function prerequisites() {
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: PRISM, encoding: 'utf8' }).trim()
  if (commit !== PIN) throw new Error(`Prism must be checked out at ${PIN}`)
  for (const required of [
    path.join(PRISM, 'native', 'build', 'Release', 'visualizer_dsp.node'),
    path.join(PRISM, 'node_modules', 'electron', 'dist', 'electron.exe'),
  ]) {
    if (!fs.existsSync(required)) throw new Error(`Missing prerequisite: ${required}`)
  }
  execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' })
  execFileSync('ffprobe', ['-version'], { stdio: 'ignore' })
}

async function build() {
  prerequisites()
  const esbuild = require(path.join(PRISM, 'node_modules', 'esbuild'))
  const targets = new Set(['Vectorscope.ts', 'SpectrumAnalyzer.ts', 'Oscilloscope.ts', 'Spectrogram.ts', 'Waveform.ts'].map(name =>
    path.join(PRISM, 'src', 'renderer', 'visualizers', name)))
  const marker = '  private drawFrame = (): void => {'
  const outdir = path.join(ROOT, 'artifacts', 'phase2')
  fs.mkdirSync(outdir, { recursive: true })
  const plugin = {
    name: 'explicit-meter-frame',
    setup(bundle) {
      bundle.onLoad({ filter: /(?:Vectorscope|SpectrumAnalyzer|Oscilloscope|Spectrogram|Waveform)\.ts$/ }, args => {
        if (!targets.has(path.resolve(args.path))) return null
        const source = fs.readFileSync(args.path, 'utf8')
        if (source.split(marker).length !== 2) throw new Error('Pinned Prism frame seam changed')
        const seam = path.basename(args.path) === 'Oscilloscope.ts'
          ? '  renderFrame(): void { this.samplesReceived = Math.max(this.samplesReceived, Oscilloscope.WARMUP_SAMPLES); this.drawFrame() }'
          : '  renderFrame(): void { this.drawFrame() }'
        return { contents: source.replace(marker, `${seam}\n\n${marker}`),
          loader: 'ts', resolveDir: path.dirname(args.path) }
      })
    },
  }
  for (const [entry, output] of [['editor.ts', 'editor.js'], ['export-renderer.ts', 'export-renderer.js']]) {
    await esbuild.build({ entryPoints: [path.join(__dirname, entry)],
      outfile: path.join(outdir, output), bundle: true, platform: 'browser',
      format: 'iife', target: 'chrome120', plugins: [plugin] })
  }
  return path.join(PRISM, 'node_modules', 'electron', 'dist', 'electron.exe')
}

if (require.main === module) build().catch(error => { console.error(error.message); process.exitCode = 1 })
module.exports = { build }

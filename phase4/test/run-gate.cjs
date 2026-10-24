const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { build } = require('../../phase2/build.cjs')
const { compositionProject, imageLayer, textLayer, vectorscopeLayer, spectrumLayer, oscilloscopeLayer, normalizeProject } = require('../../phase2/project.cjs')
const { saveArtwork } = require('../../phase2/assets.cjs')

const ROOT = path.resolve(__dirname, '..', '..')
async function main() {
  const input = path.join(ROOT, 'artifacts', 'phase3', 'spectrum-10s-48k.wav')
  const cover = path.join(ROOT, 'artifacts', 'phase4', 'generated-cover.png')
  if (!fs.existsSync(input) || !fs.existsSync(cover)) throw new Error('Generate Phase 3 audio and Phase 4 artwork fixtures first')
  const dir = path.join(ROOT, 'artifacts', 'phase4', `gate-${Date.now()}`)
  fs.mkdirSync(dir, { recursive: true })
  const projectPath = path.join(dir, 'composition.json')
  const output = path.join(dir, 'composition-720p.mp4')
  const layout = compositionProject()
  layout.title = 'Phase 4 fixture composition'
  layout.audioPath = input
  layout.background = { type: 'gradient', color: '#111a32', color2: '#24425a', imagePath: '', fit: 'cover' }
  layout.layers = [
    { ...vectorscopeLayer('gate-scope'), x: 300, y: 224, w: 430, h: 330, mode: 'polar-bipolar' },
    { ...spectrumLayer('gate-spectrum'), x: 175, y: 530, w: 930, h: 170 },
    { ...oscilloscopeLayer('gate-wave'), x: 740, y: 245, w: 465, h: 260 },
    { ...imageLayer('gate-art'), x: 75, y: 245, w: 370, h: 280, imagePath: cover, opacity: 0.83, rotation: 6, shadow: 12 },
    { ...textLayer('gate-title', 'Song title', 'SYNTHETIC HORIZONS'), x: 70, y: 43, w: 1120, h: 90, fontSize: 58, shadow: 12 },
    { ...textLayer('gate-artist', 'Artist', 'Fixture Artist'), x: 99, y: 470, w: 510, h: 58,
      fontSize: 31, fontFamily: 'Georgia', color: '#fff5d9', shadow: 10 },
  ]
  const valid = normalizeProject(layout)
  const document = { ...saveArtwork(valid, projectPath), audioPath: undefined,
    audioRelativePath: path.relative(dir, input).replaceAll('\\', '/') }
  fs.writeFileSync(projectPath, JSON.stringify(document, null, 2) + '\n')
  const electron = await build()
  const log = fs.openSync(path.join(dir, 'editor.log'), 'w')
  const child = spawn(electron, [path.join(ROOT, 'phase2', 'editor-app')], {
    env: { ...process.env, PHASE2_HEADLESS: '1', PHASE4_COMPOSITION_SMOKE: '1',
      PHASE2_TEST_INPUT: input, PHASE2_TEST_PROJECT_PATH: projectPath,
      PHASE2_TEST_OUTPUT_PATH: output, PHASE4_GATE_DIR: dir },
    stdio: ['ignore', log, log], shell: false, windowsHide: true,
  })
  const code = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { child.kill(); reject(new Error('Composition editor gate timed out')) }, 300000)
    child.once('error', error => { clearTimeout(timeout); reject(error) })
    child.once('close', result => { clearTimeout(timeout); resolve(result) })
  })
  fs.closeSync(log)
  console.log(dir)
  if (code !== 0 || !fs.existsSync(output)) throw new Error(`Editor gate failed (exit ${code}); see editor.log`)
}
main().catch(error => { console.error(error.stack || error); process.exitCode = 1 })

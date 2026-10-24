// Re-run each earlier meter's editor/native/export gate after Phase 3.8 changes.
const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { build } = require('../../phase2/build.cjs')

const ROOT = path.resolve(__dirname, '..', '..')
const DEST = path.join(ROOT, 'artifacts', 'phase3', 'vectorscope')
const cases = [
  ['spectrum', 'PHASE3_SPECTRUM_SMOKE', 'spectrum-10s-48k.wav'],
  ['oscilloscope', 'PHASE3_OSCILLOSCOPE_SMOKE', 'spectrum-10s-48k.wav'],
  ['spectrogram', 'PHASE3_SPECTROGRAM_SMOKE', 'spectrum-10s-48k.wav'],
  ['waveform', 'PHASE3_WAVEFORM_SMOKE', 'waveform-10s-48k.wav'],
  ['vu', 'PHASE3_VU_SMOKE', 'vu-10s-48k.wav'],
  ['loudness', 'PHASE3_LOUDNESS_SMOKE', 'loudness-10s-48k.wav'],
  ['waterfall', 'PHASE3_WATERFALL_SMOKE', 'spectrum-10s-48k.wav'],
]

async function main() {
  const electron = await build()
  fs.mkdirSync(DEST, { recursive: true })
  const results = []
  for (const [name, flag, fixture] of cases) {
    const output = path.join(DEST, `regression-${name}.mp4`)
    const project = path.join(DEST, `regression-${name}.json`)
    if (fs.existsSync(output)) throw new Error(`Remove or rename the existing regression artifact: ${output}`)
    const log = path.join(DEST, `regression-${name}.log`)
    const stream = fs.openSync(log, 'w')
    const started = Date.now()
    const child = spawn(electron, [path.join(ROOT, 'phase2', 'editor-app')], {
      env: { ...process.env, PHASE2_HEADLESS: '1', [flag]: '1',
        PHASE2_TEST_INPUT: path.join(ROOT, 'artifacts', 'phase3', fixture),
        PHASE2_TEST_PROJECT_PATH: project, PHASE2_TEST_OUTPUT_PATH: output },
      stdio: ['ignore', stream, stream], shell: false, windowsHide: true,
    })
    const code = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { child.kill(); reject(new Error(`${name} timed out`)) }, 300000)
      child.once('error', error => { clearTimeout(timeout); reject(error) })
      child.once('close', result => { clearTimeout(timeout); resolve(result) })
    })
    fs.closeSync(stream)
    if (code !== 0 || !fs.existsSync(output)) {
      throw new Error(`${name} failed (exit ${code}, output ${fs.existsSync(output)}); see ${log}`)
    }
    const result = { name, status: 'PASS', seconds: (Date.now() - started) / 1000,
      outputBytes: fs.statSync(output).size }
    results.push(result)
    console.log(JSON.stringify(result))
  }
  fs.writeFileSync(path.join(DEST, 'regressions.json'), JSON.stringify(results, null, 2) + '\n')
}
main().catch(error => { console.error(error.stack || error); process.exitCode = 1 })

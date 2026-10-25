const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { app } = require('electron')
const { defaultProject, normalizeProject, vectorscopeLayer, spectrumLayer,
  oscilloscopeLayer, spectrogramLayer, waveformLayer, vuLayer,
  loudnessLayer, waterfallLayer } = require('../../phase2/project.cjs')

const ROOT = path.resolve(__dirname, '..', '..')
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

module.exports = async function allMetersSmoke(win) {
  const input = path.resolve(process.env.PHASE2_TEST_INPUT)
  const projectPath = path.resolve(process.env.PHASE2_TEST_PROJECT_PATH)
  const DEST = path.dirname(projectPath)
  const layout = [
    { ...vectorscopeLayer('all-vectorscope'), mode: 'polar-unipolar', multiband: true,
      showCorrelation: true, color: '#55f4e8' },
    { ...spectrumLayer('all-spectrum'), showSideLine: true, color: '#f8bb66' },
    { ...oscilloscopeLayer('all-oscilloscope'), color: '#6ce8f4' },
    { ...spectrogramLayer('all-spectrogram'), color: '#62dafa' },
    { ...waveformLayer('all-waveform'), multiband: true, color: '#38bdf8' },
    { ...vuLayer('all-vu'), mode: 'needle', needleChannels: 'stereo', color: '#f4cf71' },
    { ...loudnessLayer('all-loudness'), readout: 'momentary', color: '#a0e68a' },
    { ...waterfallLayer('all-waterfall'), color: '#ee92d2' },
  ].map((layer, index) => ({ ...layer,
    x: 20 + (index % 4) * 310, y: 160 + Math.floor(index / 4) * 235,
    w: 300, h: 215 }))
  const project = normalizeProject({ ...defaultProject(), title: 'Eight Prism meters',
    audioPath: input, layers: layout })
  const document = { ...project, audioPath: undefined,
    audioRelativePath: path.relative(path.dirname(projectPath), input).replaceAll('\\', '/') }
  fs.writeFileSync(projectPath, JSON.stringify(document, null, 2) + '\n')

  const evaluate = expression => win.webContents.executeJavaScript(expression)
  async function waitFor(expression, label, timeout = 300000) {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      if (await evaluate(expression)) return
      await delay(100)
    }
    throw new Error(`Timed out waiting for ${label}: ${await evaluate('document.querySelector("#status").textContent')}`)
  }
  await waitFor('document.querySelector("#status").textContent.includes("Real Prism")', 'initial still')
  await evaluate('document.getElementById("open-project").click()')
  await waitFor('document.querySelectorAll(".layer-item").length === 8 && document.querySelector("#status").textContent.includes("Real Prism") && document.querySelector("#preview-busy").hidden', 'all eight preview')
  assert.equal(await evaluate('document.querySelectorAll(".layer-item").length'), 8)
  for (const [seconds, name] of [[3.5, 'all-eight-tone.png'], [5.5, 'all-eight-anti-phase.png'], [9, 'all-eight-one-khz.png']]) {
    await evaluate(`(() => { const input=document.getElementById('time-input'); input.value='${seconds}'; input.dispatchEvent(new Event('change',{bubbles:true})); return true })()`)
    await waitFor(`document.querySelector('#status').textContent.includes('${seconds.toFixed(2)} s') && document.querySelector('#status').textContent.includes('Real Prism') && document.querySelector('#preview-busy').hidden`, name)
    const encoded = await evaluate('document.getElementById("stage").toDataURL("image/png").split(",")[1]')
    fs.writeFileSync(path.join(DEST, name), Buffer.from(encoded, 'base64'))
  }
  await evaluate('document.getElementById("export-preset").value="720p"')
  await evaluate('document.getElementById("render-mp4").click()')
  await waitFor('document.querySelector("#status").textContent.includes("MP4 ready:")', 'all eight export')
  assert.ok(fs.existsSync(process.env.PHASE2_TEST_OUTPUT_PATH))
  const result = { status: 'PASS', categories: project.layers.map(layer => layer.type),
    output: process.env.PHASE2_TEST_OUTPUT_PATH, project: projectPath }
  fs.writeFileSync(path.join(DEST, 'all-meters-smoke.json'), JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify({ event: 'all-meters-smoke', ...result }))
  app.quit()
}

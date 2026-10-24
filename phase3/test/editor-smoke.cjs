const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { app } = require('electron')
const { defaultProject, spectrumLayer, normalizeProject } = require('../../phase2/project.cjs')
const { probeAudio } = require('../../phase2/audio.cjs')
const { previewSpectra, keyFor } = require('../spectrum.cjs')

const ROOT = path.resolve(__dirname, '..', '..')
const DEST = path.join(ROOT, 'artifacts', 'phase3')
const native = require(path.join(ROOT, 'upstream', 'prism', 'native', 'build', 'Release', 'visualizer_dsp.node')).spectrum
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

function floats(encoded) {
  const bytes = Buffer.from(encoded, 'base64')
  const values = new Float32Array(bytes.length / 4)
  for (let index = 0; index < values.length; index++) values[index] = bytes.readFloatLE(index * 4)
  return values
}

function peak(values, sampleRate, fftSize) {
  let bin = 1
  for (let index = 2; index < values.length; index++) {
    if (values[index] > values[bin]) bin = index
  }
  return { hz: bin * sampleRate / fftSize, db: values[bin] }
}

async function probe(input) {
  const info = probeAudio(input)
  const first = spectrumLayer('spectrum-1', 'Log spectrum')
  first.fftSize = 1024
  first.smoothing = 0
  const second = spectrumLayer('spectrum-2', 'Linear spectrum')
  second.fftSize = 4096
  second.smoothing = 0.8
  second.scaleType = 'linear'
  second.showSideLine = true
  const project = normalizeProject({ ...defaultProject(), audioPath: input, layers: [first, second] })
  const at = async seconds => previewSpectra(input, info, Math.round(seconds * 30), project, native)
  const silence = await at(1)
  const inPhase = await at(3)
  const antiPhase = await at(5)
  const leftOnly = await at(7)
  const highTone = await at(9)
  const key = keyFor(first)
  const silenceMid = floats(silence[key].mid)
  const inMid = floats(inPhase[key].mid)
  const antiMid = floats(antiPhase[key].mid)
  const antiSide = floats(antiPhase[key].side)
  const leftMid = floats(leftOnly[key].mid)
  const highMid = floats(highTone[key].mid)
  const toneBin = Math.round(440 * first.fftSize / info.sampleRate)
  const inPeak = peak(inMid, info.sampleRate, first.fftSize)
  const highPeak = peak(highMid, info.sampleRate, first.fftSize)
  assert.ok(Math.max(...silenceMid) <= -95, 'Silence should remain at the native floor')
  assert.ok(Math.abs(inPeak.hz - 440) <= info.sampleRate / first.fftSize)
  assert.ok(inPeak.db > -10 && inPeak.db < -3, `Expected calibrated 0.5-amplitude peak near -6 dBFS, got ${inPeak.db}`)
  assert.ok(antiMid[toneBin] < -90, 'Anti-phase mid spectrum should cancel')
  assert.ok(antiSide[toneBin] > -12, 'Anti-phase side spectrum should retain the tone')
  assert.ok(inMid[toneBin] - leftMid[toneBin] > 4.5 && inMid[toneBin] - leftMid[toneBin] < 7.5,
    'Left-only mid level should be about 6 dB below in-phase')
  assert.ok(Math.abs(highPeak.hz - 1000) <= info.sampleRate / first.fftSize)
  assert.equal(floats(inPhase[keyFor(second)].mid).length, second.fftSize / 2)
  const firstAlone = normalizeProject({ ...project, layers: [first] })
  const isolated = await previewSpectra(input, info, 90, firstAlone, native)
  assert.equal(isolated[key].mid, inPhase[key].mid, 'Second FFT configuration must not alter the first')
  const extraFftPeaks = {}
  for (const fftSize of [2048, 8192]) {
    const layer = spectrumLayer(`spectrum-${fftSize}`, `${fftSize} FFT`)
    layer.fftSize = fftSize
    layer.smoothing = 0
    const fftProject = normalizeProject({ ...defaultProject(), audioPath: input, layers: [layer] })
    const values = await previewSpectra(input, info, 90, fftProject, native)
    const bins = floats(values[keyFor(layer)].mid)
    assert.equal(bins.length, fftSize / 2)
    const result = peak(bins, info.sampleRate, fftSize)
    assert.ok(Math.abs(result.hz - 440) <= info.sampleRate / fftSize)
    extraFftPeaks[fftSize] = result
  }
  const monoInput = path.join(ROOT, 'artifacts', 'phase1', 'fixtures', 'mono-10s-44k.wav')
  let monoPeak = null
  if (fs.existsSync(monoInput)) {
    const monoInfo = probeAudio(monoInput)
    const monoLayer = spectrumLayer('mono-spectrum', 'Mono spectrum')
    const monoProject = normalizeProject({ ...defaultProject(), audioPath: monoInput, layers: [monoLayer] })
    const monoValues = await previewSpectra(monoInput, monoInfo, 90, monoProject, native)
    const monoBins = monoValues[keyFor(monoLayer)]
    monoPeak = peak(floats(monoBins.mid), monoInfo.sampleRate, monoLayer.fftSize)
    assert.ok(Math.abs(monoPeak.hz - 440) <= monoInfo.sampleRate / monoLayer.fftSize)
    assert.ok(Math.max(...floats(monoBins.side)) <= -95, 'Duplicated mono input should have no side energy')
  }
  const longInput = path.join(ROOT, 'artifacts', 'phase1', 'fixtures', 'stereo-180s-48k.wav')
  let longSeek = 'not run: long fixture unavailable'
  if (fs.existsSync(longInput)) {
    const longInfo = probeAudio(longInput)
    const longProject = normalizeProject({ ...defaultProject(), audioPath: longInput, layers: [second] })
    const longKey = keyFor(second)
    const at90 = await previewSpectra(longInput, longInfo, 90 * 30, longProject, native)
    const at150 = await previewSpectra(longInput, longInfo, 150 * 30, longProject, native)
    const back90 = await previewSpectra(longInput, longInfo, 90 * 30, longProject, native)
    assert.equal(at90[longKey].mid, back90[longKey].mid, 'Long backward seek must restore spectrum history')
    assert.notEqual(at90[longKey].mid, at150[longKey].mid, 'Different stereo sections must produce different spectra')
    longSeek = 'PASS at 90, 150, then 90 seconds'
  }
  return { silenceMaxDb: Math.max(...silenceMid), peak440: inPeak, peak1000: highPeak,
    antiMidDb: antiMid[toneBin], antiSideDb: antiSide[toneBin],
    leftOnlyDropDb: inMid[toneBin] - leftMid[toneBin],
    secondFftBins: second.fftSize / 2, extraFftPeaks, monoPeak, longSeek }
}

module.exports = async function spectrumSmoke(win) {
  fs.mkdirSync(DEST, { recursive: true })
  const input = path.resolve(process.env.PHASE2_TEST_INPUT)
  const numerical = await probe(input)
  const evaluate = expression => win.webContents.executeJavaScript(expression)
  async function waitFor(expression, label, timeout = 30000) {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      if (await evaluate(expression)) return
      await delay(100)
    }
    throw new Error(`Timed out waiting for ${label}; status: ${await evaluate('document.querySelector("#status").textContent')}`)
  }
  async function setInput(id, value) {
    await evaluate(`(() => { const input = document.getElementById(${JSON.stringify(id)}); input.value = ${JSON.stringify(String(value))}; input.dispatchEvent(new Event('change', { bubbles: true })); return true })()`)
  }
  async function click(id) { await evaluate(`document.getElementById(${JSON.stringify(id)}).click()`) }
  async function saveCanvas(name) {
    const data = await evaluate('document.querySelector("#stage").toDataURL("image/png").split(",")[1]')
    fs.writeFileSync(path.join(DEST, name), Buffer.from(data, 'base64'))
  }
  async function still(seconds, name) {
    await setInput('time-input', String(seconds))
    await waitFor(`document.querySelector("#status").textContent.includes("${seconds.toFixed(2)} s") && document.querySelector("#status").textContent.includes("Real Prism") && document.querySelector("#preview-busy").hidden`, `${seconds}-second spectrum still`, 60000)
    await saveCanvas(name)
  }

  await waitFor('document.querySelector("#status").textContent.includes("Real Prism")', 'initial still')
  await evaluate('(() => { const title=document.querySelector("#title"); title.value="Spectrum Study"; title.dispatchEvent(new Event("input",{bubbles:true})); return true })()')
  await setInput('layer-w', 300)
  await setInput('layer-h', 300)
  await setInput('layer-x', 910)
  await setInput('layer-y', 230)
  await setInput('add-type', 'spectrum')
  await click('add-layer')
  await setInput('layer-name', '440 Hz detail')
  await setInput('layer-x', 80)
  await setInput('layer-y', 185)
  await setInput('layer-w', 760)
  await setInput('layer-h', 200)
  await setInput('spectrum-fft', 1024)
  await setInput('spectrum-smoothing', 0)
  await setInput('spectrum-scale', 'log')
  await click('add-layer')
  await setInput('layer-name', 'Wide linear spectrum')
  await setInput('layer-x', 80)
  await setInput('layer-w', 760)
  await setInput('layer-h', 200)
  await setInput('layer-y', 415)
  await setInput('spectrum-fft', 4096)
  await setInput('spectrum-smoothing', 0.8)
  await setInput('spectrum-scale', 'linear')
  await evaluate('(() => { const color=document.querySelector("#layer-color"); color.value="#78d9f1"; color.dispatchEvent(new Event("input",{bubbles:true})); return true })()')
  await evaluate('(() => { const input=document.querySelector("#spectrum-side"); input.checked=true; input.dispatchEvent(new Event("change",{bubbles:true})); return true })()')
  await still(1, 'silence.png')
  await still(3, 'in-phase.png')
  await still(5, 'anti-phase.png')
  await still(7, 'left-only.png')
  await still(9, 'one-khz.png')
  await still(3, 'in-phase-repeat.png')
  const digest = name => createHash('sha256').update(fs.readFileSync(path.join(DEST, name))).digest('hex')
  assert.equal(digest('in-phase.png'), digest('in-phase-repeat.png'), 'Backward seek must restore identical history')
  assert.notEqual(digest('silence.png'), digest('in-phase.png'))
  assert.notEqual(digest('in-phase.png'), digest('anti-phase.png'))
  assert.notEqual(digest('in-phase.png'), digest('one-khz.png'))
  await click('save-project')
  await waitFor('document.querySelector("#status").textContent.includes("Saved project")', 'project save')
  const saved = JSON.parse(fs.readFileSync(process.env.PHASE2_TEST_PROJECT_PATH, 'utf8'))
  assert.equal(saved.layers.length, 3)
  assert.equal(saved.title, 'Spectrum Study')
  assert.deepEqual(saved.layers.filter(layer => layer.type === 'spectrum').map(layer => layer.fftSize), [1024, 4096])
  assert.deepEqual(saved.layers.filter(layer => layer.type === 'spectrum').map(layer => layer.scaleType), ['log', 'linear'])
  assert.deepEqual(saved.layers.filter(layer => layer.type === 'spectrum').map(layer => layer.color), ['#f8bb66', '#78d9f1'])
  await setInput('spectrum-scale', 'mel')
  await saveCanvas('mel-scale.png')
  assert.notEqual(digest('in-phase.png'), digest('mel-scale.png'), 'Mel scale should change the drawn frequency mapping')
  await click('open-project')
  await waitFor('document.querySelector("#spectrum-scale").value === "linear"', 'spectrum settings reload')
  await still(3, 'in-phase-reloaded.png')
  assert.equal(digest('in-phase.png'), digest('in-phase-reloaded.png'))
  await evaluate('document.querySelector("#export-preset").value = "720p"')
  await evaluate('window.__smokeBusy = document.querySelector("#preview-busy"); window.__smokeBusy.remove()')
  if (!win.isVisible()) win.showInactive()
  win.webContents.invalidate()
  await delay(500)
  fs.writeFileSync(path.join(DEST, 'editor-window.png'), (await win.capturePage()).toPNG())
  await evaluate('document.querySelector("#stage-wrap").append(window.__smokeBusy); delete window.__smokeBusy')
  if (process.env.PHASE2_HEADLESS === '1') win.hide()
  await click('render-mp4')
  await waitFor('document.querySelector("#status").textContent.includes("MP4 ready:")', 'spectrum MP4 export', 180000)
  assert.ok(fs.existsSync(process.env.PHASE2_TEST_OUTPUT_PATH))
  const result = { status: 'PASS', numerical, layers: saved.layers.length,
    output: process.env.PHASE2_TEST_OUTPUT_PATH, project: process.env.PHASE2_TEST_PROJECT_PATH }
  fs.writeFileSync(path.join(DEST, 'spectrum-smoke.json'), JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify({ event: 'spectrum-smoke', ...result }))
  app.quit()
}

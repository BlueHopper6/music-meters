const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { app } = require('electron')
const { defaultProject, spectrumLayer, oscilloscopeLayer, normalizeProject } = require('../../phase2/project.cjs')
const { probeAudio } = require('../../phase2/audio.cjs')
const { previewOscilloscopes, precomputeOscilloscopes, displaySamples } = require('../oscilloscope.cjs')

const ROOT = path.resolve(__dirname, '..', '..')
const DEST = path.join(ROOT, 'artifacts', 'phase3', 'oscilloscope')
const native = require(path.join(ROOT, 'upstream', 'prism', 'native', 'build', 'Release', 'visualizer_dsp.node')).oscilloscope
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

function floats(encoded) {
  const bytes = Buffer.from(encoded, 'base64')
  const values = new Float32Array(bytes.length / 4)
  for (let index = 0; index < values.length; index++) values[index] = bytes.readFloatLE(index * 4)
  return values
}

function rms(values) {
  return Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length)
}

function correlation(a, b) {
  const dot = a.reduce((sum, value, index) => sum + value * b[index], 0)
  return dot / Math.sqrt(a.reduce((sum, value) => sum + value * value, 0)
    * b.reduce((sum, value) => sum + value * value, 0))
}

function frequency(values, sampleRate) {
  let crossings = 0
  for (let index = 1; index < values.length; index++) {
    if (values[index - 1] < 0 && values[index] >= 0) crossings++
  }
  return crossings * sampleRate / (values.length - 1)
}

async function probe(input) {
  const metadata = probeAudio(input)
  const locked = oscilloscopeLayer('locked', 'Pitch lock')
  const free = { ...oscilloscopeLayer('free', 'Free run'), pitchLock: false }
  const project = normalizeProject({ ...defaultProject(), audioPath: input, layers: [locked, free] })
  const at = frame => previewOscilloscopes(input, metadata, frame, project, native)
  const silence = await at(30)
  const tone = await at(105)
  const next = await at(106)
  const high = await at(270)
  const silentWave = floats(silence.locked.samples)
  const lockedWave = floats(tone.locked.samples)
  const freeWave = floats(tone.free.samples)
  const highWave = floats(high.locked.samples)
  assert.equal(silentWave.length, displaySamples(metadata.sampleRate))
  assert.ok(Math.max(...silentWave.map(Math.abs)) < 0.001, 'Silent input must draw silence')
  assert.ok(rms(lockedWave) > 0.1 && rms(freeWave) > 0.1, 'Tone must produce a real wave')
  const lowFrequency = frequency(lockedWave, metadata.sampleRate)
  const highFrequency = frequency(highWave, metadata.sampleRate)
  assert.ok(Math.abs(lowFrequency - 440) < 30, `Expected a 440 Hz wave, got ${lowFrequency}`)
  assert.ok(Math.abs(highFrequency - 1000) < 60, `Expected a 1 kHz wave, got ${highFrequency}`)
  const lockedStability = correlation(lockedWave, floats(next.locked.samples))
  const freeStability = correlation(freeWave, floats(next.free.samples))
  assert.ok(lockedStability > 0.9, `Pitch trigger did not stabilize the wave: ${lockedStability}`)
  assert.ok(lockedStability > freeStability + 0.2,
    `Pitch lock should be more stable than free run: ${lockedStability}, ${freeStability}`)
  const isolated = normalizeProject({ ...project, layers: [locked] })
  const lockedAlone = await previewOscilloscopes(input, metadata, 105, isolated, native)
  assert.equal(lockedAlone.locked.samples, tone.locked.samples,
    'A second oscilloscope mode must not change the pitch-locked instance')
  const freeAlone = await previewOscilloscopes(input, metadata, 105,
    normalizeProject({ ...project, layers: [free] }), native)
  assert.equal(freeAlone.free.samples, tone.free.samples,
    'A pitch-locked instance must not change the free-running instance')
  const cache = await precomputeOscilloscopes(input, metadata, project, native,
    path.join(DEST, 'parity-cache'), () => true)
  try {
    for (let frame = 0; frame <= 270; frame++) {
      const snapshot = cache.frame()
      if (frame === 105 || frame === 270) {
        const reference = frame === 105 ? tone : high
        for (const mode of ['locked', 'free']) {
          assert.equal(snapshot[mode].samples, reference[mode].samples,
            `Preview and export ${mode} wave differ at frame ${frame}`)
          assert.equal(snapshot[mode].triggerIndex, reference[mode].triggerIndex,
            `Preview and export ${mode} trigger differ at frame ${frame}`)
        }
      }
    }
  } finally { cache.close() }
  const monoInput = path.join(ROOT, 'artifacts', 'phase1', 'fixtures', 'mono-10s-44k.wav')
  let mono = 'fixture unavailable'
  if (fs.existsSync(monoInput)) {
    const monoInfo = probeAudio(monoInput)
    const monoProject = normalizeProject({ ...defaultProject(), audioPath: monoInput, layers: [locked] })
    const monoData = await previewOscilloscopes(monoInput, monoInfo, 90, monoProject, native)
    assert.equal(floats(monoData.locked.samples).length, displaySamples(monoInfo.sampleRate))
    assert.ok(rms(floats(monoData.locked.samples)) > 0.05, 'Mono source should retain its wave')
    mono = `${monoInfo.sampleRate} Hz, ${displaySamples(monoInfo.sampleRate)} display samples`
  }
  return { sampleRate: metadata.sampleRate, samplesPerWave: lockedWave.length,
    silencePeak: Math.max(...silentWave.map(Math.abs)), toneRms: rms(lockedWave),
    lowFrequency, highFrequency, detectedPitch440: tone.locked.detectedPitch,
    detectedPitch1000: high.locked.detectedPitch, lockedStability, freeStability,
    previewExportData: 'exact at frames 105 and 270 for both modes', mono }
}

module.exports = async function oscilloscopeSmoke(win) {
  fs.mkdirSync(DEST, { recursive: true })
  const input = path.resolve(process.env.PHASE2_TEST_INPUT)
  const evaluate = expression => win.webContents.executeJavaScript(expression)
  async function waitFor(expression, label, timeout = 30000) {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      if (await evaluate(expression)) return
      await delay(100)
    }
    throw new Error(`Timed out waiting for ${label}: ${await evaluate('document.querySelector("#status").textContent')}`)
  }
  async function setInput(id, value) {
    await evaluate(`(() => { const input = document.getElementById(${JSON.stringify(id)}); input.value = ${JSON.stringify(String(value))}; input.dispatchEvent(new Event('change', { bubbles: true })); return true })()`)
  }
  async function setCheck(id, value) {
    await evaluate(`(() => { const input = document.getElementById(${JSON.stringify(id)}); input.checked = ${JSON.stringify(value)}; input.dispatchEvent(new Event('change', { bubbles: true })); return true })()`)
  }
  async function click(id) { await evaluate(`document.getElementById(${JSON.stringify(id)}).click()`) }
  async function saveCanvas(name) {
    const data = await evaluate('document.querySelector("#stage").toDataURL("image/png").split(",")[1]')
    fs.writeFileSync(path.join(DEST, name), Buffer.from(data, 'base64'))
  }
  async function still(seconds, name) {
    await setInput('time-input', String(seconds))
    await waitFor(`document.querySelector("#status").textContent.includes("${seconds.toFixed(2)} s") && document.querySelector("#status").textContent.includes("Real Prism") && document.querySelector("#preview-busy").hidden`, `${seconds}-second still`, 60000)
    await saveCanvas(name)
  }
  await waitFor('document.querySelector("#status").textContent.includes("Real Prism")', 'initial still')
  const numerical = await probe(input)
  await evaluate('(() => { const title=document.querySelector("#title"); title.value="Oscilloscope Study"; title.dispatchEvent(new Event("input",{bubbles:true})); return true })()')
  await setInput('layer-w', 300)
  await setInput('layer-h', 300)
  await setInput('layer-x', 910)
  await setInput('layer-y', 230)
  await setInput('add-type', 'spectrum')
  await click('add-layer')
  await setInput('layer-w', 760)
  await setInput('layer-h', 160)
  await setInput('layer-x', 80)
  await setInput('layer-y', 180)
  await setInput('spectrum-smoothing', 0)
  await setInput('add-type', 'oscilloscope')
  await click('add-layer')
  await setInput('layer-name', 'Pitch triggered')
  await setInput('layer-w', 760)
  await setInput('layer-h', 150)
  await setInput('layer-x', 80)
  await setInput('layer-y', 355)
  await setCheck('oscilloscope-underfill', true)
  await click('add-layer')
  await setInput('layer-name', 'Free running')
  await setInput('layer-w', 760)
  await setInput('layer-h', 155)
  await setInput('layer-x', 80)
  await setInput('layer-y', 515)
  await setCheck('oscilloscope-pitch-lock', false)
  await setCheck('oscilloscope-grid', false)
  await still(1, 'silence.png')
  await still(3, 'in-phase.png')
  await still(5, 'anti-phase.png')
  await still(7, 'left-only.png')
  await still(9, 'one-khz.png')
  await still(3, 'in-phase-repeat.png')
  const digest = name => createHash('sha256').update(fs.readFileSync(path.join(DEST, name))).digest('hex')
  assert.equal(digest('in-phase.png'), digest('in-phase-repeat.png'), 'Backward seek must be exact')
  assert.notEqual(digest('silence.png'), digest('in-phase.png'))
  assert.notEqual(digest('in-phase.png'), digest('one-khz.png'))
  await click('save-project')
  await waitFor('document.querySelector("#status").textContent.includes("Saved project")', 'save project')
  const saved = JSON.parse(fs.readFileSync(process.env.PHASE2_TEST_PROJECT_PATH, 'utf8'))
  assert.deepEqual(saved.layers.map(layer => [layer.x, layer.y, layer.w, layer.h]),
    [[910, 230, 300, 300], [80, 180, 760, 160], [80, 355, 760, 150], [80, 515, 760, 155]])
  assert.deepEqual(saved.layers.filter(layer => layer.type === 'oscilloscope').map(layer =>
    [layer.pitchLock, layer.underfillEnabled, layer.showGrid]), [[true, true, true], [false, false, false]])
  await setCheck('oscilloscope-grid', true)
  await click('open-project')
  await waitFor('document.querySelector("#oscilloscope-grid").checked === false', 'restore oscilloscope settings')
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
  await waitFor('document.querySelector("#status").textContent.includes("MP4 ready:")', 'oscilloscope MP4', 240000)
  assert.ok(fs.existsSync(process.env.PHASE2_TEST_OUTPUT_PATH))
  const result = { status: 'PASS', numerical, layers: saved.layers.length,
    output: process.env.PHASE2_TEST_OUTPUT_PATH, project: process.env.PHASE2_TEST_PROJECT_PATH }
  fs.writeFileSync(path.join(DEST, 'oscilloscope-smoke.json'), JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify({ event: 'oscilloscope-smoke', ...result }))
  app.quit()
}

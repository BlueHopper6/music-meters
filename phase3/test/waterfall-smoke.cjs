const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { app } = require('electron')
const { defaultProject, waterfallLayer, normalizeProject } = require('../../phase2/project.cjs')
const { probeAudio } = require('../../phase2/audio.cjs')
const { configuration, previewWaterfalls, precomputeWaterfalls } = require('../waterfall.cjs')

const ROOT = path.resolve(__dirname, '..', '..')
const DEST = path.join(ROOT, 'artifacts', 'phase3', 'waterfall')
const native = require(path.join(ROOT, 'upstream', 'prism', 'native', 'build', 'Release', 'visualizer_dsp.node')).waterfall
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const floats = encoded => {
  const bytes = Buffer.from(encoded, 'base64')
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4)
}
function peaks(frame) {
  const levels = floats(frame.levels), frequencies = floats(frame.frequencies), ages = floats(frame.ages)
  return Array.from(ages, (age, row) => {
    const ridge = levels.subarray(row * frame.columns, (row + 1) * frame.columns)
    const value = Math.max(...ridge)
    return { age, value, hz: frequencies[ridge.indexOf(value)] }
  })
}

async function numerical(input) {
  const metadata = probeAudio(input)
  const a = { ...waterfallLayer('waterfall-a'), x: 40, y: 170, w: 570, h: 440,
    fftSize: 2048, smoothing: 0, tiltDbPerOctave: 0 }
  const b = { ...waterfallLayer('waterfall-b'), x: 650, y: 170, w: 570, h: 440,
    fftSize: 4096, scaleMode: 'mel', historySeconds: 8, density: 'dense', colorMode: 'heat',
    smoothing: 0, tiltDbPerOctave: 0, showGrid: false }
  const project = normalizeProject({ ...defaultProject(), audioPath: input, layers: [a, b] })
  const at = frame => previewWaterfalls(input, metadata, frame, project, native)
  const silence = await at(30), tone = await at(105), anti = await at(165)
  const left = await at(225), transition = await at(244), high = await at(270)
  assert.equal(configuration(a, 1.5, metadata.sampleRate).columns, 512)
  assert.ok(peaks(silence[a.id]).every(peak => peak.value <= -99), 'Silence must have no invented spectrum energy')
  for (const frame of [tone, anti, left]) {
    const latest = peaks(frame[a.id])[0]
    assert.ok(Math.abs(latest.hz - 440) < 60 && latest.value > -12 && latest.value < -1,
      `Expected calibrated 440 Hz ridge: ${JSON.stringify(latest)}`)
  }
  const latestHigh = peaks(high[a.id])[0]
  assert.ok(Math.abs(latestHigh.hz - 1000) < 100 && latestHigh.value > -12,
    `Expected 1 kHz ridge: ${JSON.stringify(latestHigh)}`)
  const history = peaks(transition[a.id])
  assert.ok(history.some(peak => Math.abs(peak.hz - 440) < 60 && peak.value > -12)
    && history.some(peak => Math.abs(peak.hz - 1000) < 100 && peak.value > -12),
  'Native ridges must preserve both old and new frequencies through the transition')
  assert.ok(history.every(peak => peak.age >= 0 && peak.age <= a.historySeconds + 0.01))
  assert.ok(peaks(high[b.id]).length > peaks(high[a.id]).length, 'Dense history must show more ridges')
  for (const layer of [a, b]) {
    const alone = await previewWaterfalls(input, metadata, 105,
      normalizeProject({ ...project, layers: [layer] }), native)
    assert.deepEqual(alone[layer.id], tone[layer.id], `${layer.id} changed with another waterfall present`)
  }
  const ratePeaks = {}
  for (const [rate, filename] of [[44100, 'spectrum-10s-44k1.wav'], [96000, 'spectrum-10s-96k.wav']]) {
    const variant = path.join(ROOT, 'artifacts', 'phase3', filename)
    const data = await previewWaterfalls(variant, probeAudio(variant), 105,
      normalizeProject({ ...project, audioPath: variant, layers: [a] }), native)
    const peak = peaks(data[a.id])[0]
    assert.ok(Math.abs(peak.hz - 440) < 75 && peak.value > -12 && peak.value < -1,
      `${rate} Hz sample rate lost the 440 Hz ridge: ${JSON.stringify(peak)}`)
    ratePeaks[rate] = peak
  }
  const cache = await precomputeWaterfalls(input, metadata, project, native,
    path.join(DEST, 'parity-cache'), 1, () => true)
  try {
    for (let index = 0; index <= 270; index++) {
      const data = cache.frame()
      if ([105, 165, 225, 244, 270].includes(index)) {
        const reference = { 105: tone, 165: anti, 225: left, 244: transition, 270: high }[index]
        for (const id of [a.id, b.id]) assert.deepEqual(data[id], reference[id], `${id} preview/export frame ${index}`)
      }
    }
  } finally { cache.close() }
  return { silence: peaks(silence[a.id])[0], tone: peaks(tone[a.id])[0],
    anti: peaks(anti[a.id])[0], left: peaks(left[a.id])[0], high: latestHigh,
    transitionHz: history.map(peak => Math.round(peak.hz)),
    ridgeCounts: [peaks(high[a.id]).length, peaks(high[b.id]).length], ratePeaks }
}

module.exports = async function waterfallSmoke(win) {
  fs.mkdirSync(DEST, { recursive: true })
  const input = path.resolve(process.env.PHASE2_TEST_INPUT)
  const evaluate = expression => win.webContents.executeJavaScript(expression)
  async function waitFor(expression, label, timeout = 300000) {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      if (await evaluate(expression)) return
      await delay(100)
    }
    throw new Error(`Timed out waiting for ${label}: ${await evaluate('document.querySelector("#status").textContent')}`)
  }
  async function setInput(id, value) {
    await evaluate(`(() => { const input=document.getElementById(${JSON.stringify(id)}); input.value=${JSON.stringify(String(value))}; input.dispatchEvent(new Event('change',{bubbles:true})); return true })()`)
  }
  async function still(seconds, name) {
    await setInput('time-input', seconds)
    await waitFor(`document.querySelector('#status').textContent.includes('${seconds.toFixed(2)} s') && document.querySelector('#status').textContent.includes('Real Prism') && document.querySelector('#preview-busy').hidden`, name)
    const data = await evaluate('document.querySelector("#stage").toDataURL("image/png").split(",")[1]')
    fs.writeFileSync(path.join(DEST, name), Buffer.from(data, 'base64'))
  }
  const click = id => evaluate(`document.getElementById(${JSON.stringify(id)}).click()`)
  await waitFor('document.querySelector("#status").textContent.includes("Real Prism")', 'initial still')
  const numbers = await numerical(input)
  await setInput('layer-w', 150); await setInput('layer-h', 150)
  await setInput('layer-x', 1100); await setInput('layer-y', 12)
  await setInput('add-type', 'waterfall'); await click('add-layer')
  await setInput('layer-w', 570); await setInput('layer-h', 440)
  await setInput('layer-x', 40); await setInput('layer-y', 170)
  await setInput('waterfall-smoothing', 0); await setInput('waterfall-tilt', 0)
  await click('add-layer')
  await setInput('layer-w', 570); await setInput('layer-h', 440)
  await setInput('layer-x', 650); await setInput('layer-y', 170)
  await setInput('waterfall-fft', 4096); await setInput('waterfall-scale', 'mel')
  await setInput('waterfall-history', 8); await setInput('waterfall-density', 'dense')
  await setInput('waterfall-color-mode', 'heat'); await setInput('waterfall-smoothing', 0)
  await setInput('waterfall-tilt', 0)
  await still(1, 'silence.png'); await still(3.5, 'tone.png')
  await still(5.5, 'anti-phase.png'); await still(7.5, 'left-only.png')
  await still(8.13, 'transition.png'); await still(9, 'one-khz.png')
  await still(3.5, 'tone-repeat.png')
  const digest = name => createHash('sha256').update(fs.readFileSync(path.join(DEST, name))).digest('hex')
  assert.equal(digest('tone.png'), digest('tone-repeat.png'), 'Backward seek must reproduce waterfall history')
  assert.notEqual(digest('silence.png'), digest('tone.png'))
  await click('save-project')
  await waitFor('document.querySelector("#status").textContent.includes("Saved project")', 'save project')
  const saved = JSON.parse(fs.readFileSync(process.env.PHASE2_TEST_PROJECT_PATH, 'utf8'))
  assert.deepEqual(saved.layers.filter(layer => layer.type === 'waterfall').map(layer =>
    [layer.x, layer.y, layer.w, layer.h, layer.fftSize, layer.scaleMode, layer.historySeconds, layer.density, layer.colorMode]),
  [[40, 170, 570, 440, 2048, 'log', 5, 'balanced', 'theme'],
    [650, 170, 570, 440, 4096, 'mel', 8, 'dense', 'heat']])
  await setInput('waterfall-density', 'sparse'); await click('open-project')
  await waitFor('document.querySelector("#waterfall-density").value === "dense"', 'restore density')
  await still(3.5, 'tone-reloaded.png')
  assert.equal(digest('tone.png'), digest('tone-reloaded.png'))
  await setInput('layer-w', 540); await still(3.5, 'resized.png')
  assert.notEqual(digest('tone.png'), digest('resized.png'))
  await setInput('layer-w', 570); await still(3.5, 'resized-restored.png')
  assert.equal(digest('tone.png'), digest('resized-restored.png'))
  await evaluate('document.querySelector("#export-preset").value="720p"')
  await click('render-mp4')
  await waitFor('document.querySelector("#status").textContent.includes("MP4 ready:")', 'waterfall MP4')
  assert.ok(fs.existsSync(process.env.PHASE2_TEST_OUTPUT_PATH))
  const result = { status: 'PASS', numerical: numbers,
    output: process.env.PHASE2_TEST_OUTPUT_PATH, project: process.env.PHASE2_TEST_PROJECT_PATH }
  fs.writeFileSync(path.join(DEST, 'waterfall-smoke.json'), JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify({ event: 'waterfall-smoke', ...result }))
  app.quit()
}

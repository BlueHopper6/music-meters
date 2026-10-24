const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { app } = require('electron')
const { defaultProject, waveformLayer, normalizeProject } = require('../../phase2/project.cjs')
const { probeAudio } = require('../../phase2/audio.cjs')
const { configurations, previewWaveforms, precomputeWaveforms } = require('../waveform.cjs')

const ROOT = path.resolve(__dirname, '..', '..')
const DEST = path.join(ROOT, 'artifacts', 'phase3', 'waveform')
const native = require(path.join(ROOT, 'upstream', 'prism', 'native', 'build', 'Release', 'visualizer_dsp.node')).waveform
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

function floats(encoded) {
  const bytes = Buffer.from(encoded, 'base64')
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4)
}

function latest(data, id) { return floats(data[id].entries.at(-1).summary) }

async function numerical(input) {
  const metadata = probeAudio(input)
  const mono = { ...waveformLayer('mono', 'Mono multiband'), x: 40, y: 170, w: 570, h: 450,
    mode: 'mono', multiband: true, scrollSpeed: 1 }
  const stereo = { ...waveformLayer('stereo', 'Stereo'), x: 650, y: 170, w: 570, h: 450,
    mode: 'stereo', multiband: false, scrollSpeed: 4, color: '#f2c96d' }
  const project = normalizeProject({ ...defaultProject(), audioPath: input, layers: [mono, stereo] })
  const at = frame => previewWaveforms(input, metadata, frame, project, native)
  const silence = await at(30)
  const low = await at(105)
  const anti = await at(165)
  const leftOnly = await at(225)
  const transition = await at(243)
  const high = await at(270)
  const lowMono = latest(low, 'mono')
  const highMono = latest(high, 'mono')
  for (const value of [low, anti, leftOnly, transition, high]) {
    for (const [id, stride] of [['mono', 5], ['stereo', 10]]) {
      for (const entry of value[id].entries) {
        const summary = floats(entry.summary)
        for (let index = 0; index < summary.length; index += stride) {
          for (const peak of [summary[index], summary[index + 1]]) {
            assert.ok(Number.isFinite(peak) && peak >= -1 && peak <= 1, 'Waveform peak exceeded PCM bounds')
          }
          if (stride === 10) {
            for (const peak of [summary[index + 5], summary[index + 6]]) {
              assert.ok(Number.isFinite(peak) && peak >= -1 && peak <= 1, 'Right peak exceeded PCM bounds')
            }
          }
        }
      }
    }
  }
  assert.ok([...latest(silence, 'mono')].every(value => value === 0), 'Silence must produce zero peaks and bands')
  assert.ok(lowMono.length >= 5 && highMono.length >= 5)
  assert.ok(Math.max(...lowMono.filter((_, i) => i % 5 === 1)) > 0.48, '100 Hz peaks must be present')
  assert.ok(Math.max(...highMono.filter((_, i) => i % 5 === 1)) > 0.48, '5 kHz peaks must be present')
  assert.ok(Math.max(...lowMono.filter((_, i) => i % 5 === 2)) >
    Math.max(...lowMono.filter((_, i) => i % 5 === 4)) * 4, '100 Hz should favor the low band')
  assert.ok(Math.max(...highMono.filter((_, i) => i % 5 === 4)) >
    Math.max(...highMono.filter((_, i) => i % 5 === 2)) * 4, '5 kHz should favor the high band')
  const leftStereo = latest(leftOnly, 'stereo')
  assert.ok(Math.max(...leftStereo.filter((_, i) => i % 10 === 1)) > 0.48)
  assert.ok([...leftStereo.filter((_, i) => i % 10 === 5 || i % 10 === 6)].every(value => value === 0),
    'Left-only segment must leave right lane at zero')
  assert.ok(latest(anti, 'stereo').length > 0, 'Anti-phase section must have stereo columns')
  const speedColumns = [low.mono.entries.at(-1).columns, low.stereo.entries.at(-1).columns]
  assert.ok(speedColumns[1] > speedColumns[0] * 3, `Scroll speed must change column density: ${speedColumns}`)
  const transitionPeaks = transition.mono.entries.flatMap(entry => {
    const summary = floats(entry.summary)
    return [...summary.filter((_, i) => i % 5 === 1)]
  })
  assert.ok(transitionPeaks.some(value => value > 0.95), 'Pulse must survive as a peak in scrolling history')
  assert.ok(transition.mono.entries.reduce((sum, entry) => sum + entry.columns, 0) >= mono.w,
    'Preview must retain enough columns to fill the waveform width')
  assert.ok(transition.mono.entries.reduce((sum, entry) => sum + entry.columns, 0) < mono.w + 6,
    'Preview retained more than one frame beyond the visible history')
  for (const layer of [mono, stereo]) {
    const alone = await previewWaveforms(input, metadata, 105,
      normalizeProject({ ...project, layers: [layer] }), native)
    assert.deepEqual(alone[layer.id], low[layer.id], `${layer.id} changes with another instance present`)
  }
  assert.equal(configurations(project, metadata.sampleRate, 1.5)[0].span, 855)
  const cache = await precomputeWaveforms(input, metadata, project, native,
    path.join(DEST, 'parity-cache'), 1, () => true)
  try {
    for (let frame = 0; frame <= 270; frame++) {
      const data = cache.frame()
      if ([105, 165, 225, 270].includes(frame)) {
        const reference = { 105: low, 165: anti, 225: leftOnly, 270: high }[frame]
        for (const id of ['mono', 'stereo']) {
          assert.deepEqual(data[id].entries[0], reference[id].entries.at(-1),
            `Preview/export columns differ at frame ${frame} for ${id}`)
        }
      }
    }
  } finally { cache.close() }
  return { speedColumns, lowBandRms: Math.max(...lowMono.filter((_, i) => i % 5 === 2)),
    highBandRms: Math.max(...highMono.filter((_, i) => i % 5 === 4)),
    leftOnlyRightPeak: Math.max(...leftStereo.filter((_, i) => i % 10 === 6)),
    transitionPeak: Math.max(...transitionPeaks), previewExportColumns: 'exact at 105, 165, 225, 270' }
}

module.exports = async function waveformSmoke(win) {
  fs.mkdirSync(DEST, { recursive: true })
  const input = path.resolve(process.env.PHASE2_TEST_INPUT)
  const evaluate = expression => win.webContents.executeJavaScript(expression)
  async function waitFor(expression, label, timeout = 120000) {
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
  async function setCheck(id, value) {
    await evaluate(`(() => { const input=document.getElementById(${JSON.stringify(id)}); input.checked=${JSON.stringify(value)}; input.dispatchEvent(new Event('change',{bubbles:true})); return true })()`)
  }
  async function click(id) { await evaluate(`document.getElementById(${JSON.stringify(id)}).click()`) }
  async function still(seconds, name) {
    await setInput('time-input', seconds)
    await waitFor(`document.querySelector('#status').textContent.includes('${seconds.toFixed(2)} s') && document.querySelector('#status').textContent.includes('Real Prism') && document.querySelector('#preview-busy').hidden`, name)
    const data = await evaluate('document.querySelector("#stage").toDataURL("image/png").split(",")[1]')
    fs.writeFileSync(path.join(DEST, name), Buffer.from(data, 'base64'))
  }
  await waitFor('document.querySelector("#status").textContent.includes("Real Prism")', 'initial still')
  const numbers = await numerical(input)
  await setInput('layer-w', 150); await setInput('layer-h', 150)
  await setInput('layer-x', 1100); await setInput('layer-y', 12)
  await setInput('add-type', 'waveform'); await click('add-layer')
  await setInput('layer-w', 570); await setInput('layer-h', 450)
  await setInput('layer-x', 40); await setInput('layer-y', 170)
  await setInput('waveform-mode', 'mono'); await setCheck('waveform-multiband', true)
  await click('add-layer')
  await setInput('layer-w', 570); await setInput('layer-h', 450)
  await setInput('layer-x', 650); await setInput('layer-y', 170)
  await setInput('waveform-speed', 4)
  await setInput('layer-color', '#f2c96d')
  await still(1, 'silence.png')
  await still(3, 'low.png')
  await still(5, 'anti-phase.png')
  await still(7, 'left-only.png')
  await still(8.1, 'transition.png')
  await still(9, 'high.png')
  await still(3, 'low-repeat.png')
  const digest = name => createHash('sha256').update(fs.readFileSync(path.join(DEST, name))).digest('hex')
  assert.equal(digest('low.png'), digest('low-repeat.png'), 'Backward seek must reproduce history')
  assert.notEqual(digest('silence.png'), digest('low.png'))
  await click('save-project')
  await waitFor('document.querySelector("#status").textContent.includes("Saved project")', 'save project')
  const saved = JSON.parse(fs.readFileSync(process.env.PHASE2_TEST_PROJECT_PATH, 'utf8'))
  assert.deepEqual(saved.layers.filter(layer => layer.type === 'waveform').map(layer =>
    [layer.x, layer.y, layer.w, layer.h, layer.mode, layer.scrollSpeed, layer.multiband]),
  [[40, 170, 570, 450, 'mono', 1, true], [650, 170, 570, 450, 'stereo', 4, false]])
  await setInput('waveform-speed', 2); await click('open-project')
  await waitFor('document.querySelector("#waveform-speed").value === "4"', 'restore speed')
  await still(3, 'low-reloaded.png')
  assert.equal(digest('low.png'), digest('low-reloaded.png'))
  await setInput('layer-w', 540); await still(3, 'resized.png')
  assert.notEqual(digest('resized.png'), digest('low.png'))
  await setInput('layer-w', 570); await still(3, 'resized-restored.png')
  assert.equal(digest('low.png'), digest('resized-restored.png'))
  await evaluate('document.querySelector("#export-preset").value="720p"')
  await click('render-mp4')
  await waitFor('document.querySelector("#status").textContent.includes("MP4 ready:")', 'waveform MP4', 300000)
  assert.ok(fs.existsSync(process.env.PHASE2_TEST_OUTPUT_PATH))
  const result = { status: 'PASS', numerical: numbers,
    output: process.env.PHASE2_TEST_OUTPUT_PATH, project: process.env.PHASE2_TEST_PROJECT_PATH }
  fs.writeFileSync(path.join(DEST, 'waveform-smoke.json'), JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify({ event: 'waveform-smoke', ...result }))
  app.quit()
}

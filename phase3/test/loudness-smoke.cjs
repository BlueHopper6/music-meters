const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { app } = require('electron')
const { defaultProject, loudnessLayer, normalizeProject } = require('../../phase2/project.cjs')
const { probeAudio } = require('../../phase2/audio.cjs')
const { FIELDS, analyze, previewLoudness, precomputeLoudness } = require('../loudness.cjs')

const ROOT = path.resolve(__dirname, '..', '..')
const DEST = path.join(ROOT, 'artifacts', 'phase3', 'loudness')
const native = require(path.join(ROOT, 'upstream', 'prism', 'native', 'build', 'Release', 'visualizer_dsp.node')).lufsmeter
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

function reading(encoded) {
  const bytes = Buffer.from(encoded, 'base64')
  const floats = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4)
  return Object.fromEntries(FIELDS.map((field, index) => [field, floats[index]]))
}

async function numerical(input) {
  const metadata = probeAudio(input)
  const momentary = { ...loudnessLayer('loudness-m', 'Momentary'), x: 30, y: 160,
    w: 580, h: 440, readout: 'momentary' }
  const integrated = { ...loudnessLayer('loudness-i', 'Integrated'), x: 650, y: 160,
    w: 580, h: 440, readout: 'integrated', targetColor: '#b83268' }
  const project = normalizeProject({ ...defaultProject(), audioPath: input, layers: [momentary, integrated] })
  const frames = [30, 90, 150, 210, 244, 264, 270, 285, 299]
  const samples = {}
  await analyze(input, metadata, metadata.totalFrames - 1, native, () => true,
    (index, values, nativeSnapshot, peakSnapshot) => {
      if (!frames.includes(index)) return
      samples[index] = Object.fromEntries(FIELDS.map((field, offset) => [field, values[offset]]))
      assert.ok(Math.abs(nativeSnapshot.maxTruePeakDb - peakSnapshot.maxTruePeakDb) < .05,
        `Prism and frame-clocked true-peak maxima differ at ${index}: ${nativeSnapshot.maxTruePeakDb} vs ${peakSnapshot.maxTruePeakDb}`)
    }, 'Cancelled')
  assert.equal(samples[30].momentaryLUFS, -60)
  assert.equal(samples[30].integratedLUFS, -60)
  assert.ok(Math.abs(samples[90].momentaryLUFS + 20) < .6)
  assert.ok(Math.abs(samples[150].momentaryLUFS + 20) < .6)
  assert.ok(Math.abs(samples[210].momentaryLUFS + 23) < .6)
  assert.ok(samples[90].shortTermLUFS < samples[90].momentaryLUFS - 3)
  assert.ok(Math.abs(samples[299].integratedLUFS + 20.4) < .7)
  assert.ok(samples[244].maxTruePeakDb > -1)
  assert.ok(samples[264].truePeakLDb > -1, 'True peak should hold for 750 ms')
  assert.ok(samples[285].truePeakLDb < samples[264].truePeakLDb - 3,
    'True peak should decay after its hold')
  const preview = await previewLoudness(input, metadata, 270, project, native)
  assert.deepEqual(preview['loudness-m'], preview['loudness-i'])
  for (const layer of [momentary, integrated]) {
    const alone = await previewLoudness(input, metadata, 270,
      normalizeProject({ ...project, layers: [layer] }), native)
    assert.equal(alone[layer.id], preview[layer.id], 'Loudness instances should not affect analysis')
  }
  const cache = await precomputeLoudness(input, metadata, project, native,
    path.join(DEST, 'parity-cache'), () => true)
  try {
    for (let index = 0; index < metadata.totalFrames; index++) {
      const exported = cache.frame()
      if (index === 270) {
        assert.deepEqual(reading(exported['loudness-m']), reading(preview['loudness-m']))
        assert.equal(exported['loudness-m'], exported['loudness-i'])
      }
    }
  } finally { cache.close() }
  return { samples, previewExportFrame: 'exact at frame 270',
    truePeakProvenance: 'Prism cumulative native maximum matches frame-clocked port within 0.05 dB' }
}

async function rateVariants() {
  const results = {}
  for (const [rate, suffix] of [[44100, '44k1'], [96000, '96k']]) {
    const input = path.join(ROOT, 'artifacts', 'phase3', `loudness-10s-${suffix}.wav`)
    const metadata = probeAudio(input)
    assert.equal(metadata.sampleRate, rate)
    await analyze(input, metadata, metadata.totalFrames - 1, native, () => true,
      (index, _values, nativeSnapshot, peakSnapshot) => {
        if ((index + 1) % 30 !== 0) return
        assert.ok(Math.abs(nativeSnapshot.maxTruePeakDb - peakSnapshot.maxTruePeakDb) < .05,
          `${rate} Hz true-peak maxima differ at frame ${index}`)
        if (index === metadata.totalFrames - 1) {
          assert.ok(Math.abs(nativeSnapshot.integratedLUFS + 20.4) < .8)
          results[rate] = { integratedLUFS: nativeSnapshot.integratedLUFS,
            maxTruePeakDb: nativeSnapshot.maxTruePeakDb }
        }
      }, 'Cancelled')
  }
  return results
}

module.exports = async function loudnessSmoke(win) {
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
  async function click(id) { await evaluate(`document.getElementById(${JSON.stringify(id)}).click()`) }
  async function still(seconds, name) {
    await setInput('time-input', seconds)
    await waitFor(`document.querySelector('#status').textContent.includes('${seconds.toFixed(2)} s') && document.querySelector('#status').textContent.includes('Real Prism') && document.querySelector('#preview-busy').hidden`, name)
    const data = await evaluate('document.querySelector("#stage").toDataURL("image/png").split(",")[1]')
    fs.writeFileSync(path.join(DEST, name), Buffer.from(data, 'base64'))
  }
  await waitFor('document.querySelector("#status").textContent.includes("Real Prism")', 'initial still')
  const numbers = await numerical(input)
  numbers.sampleRates = await rateVariants()
  await setInput('layer-w', 160); await setInput('layer-h', 160)
  await setInput('layer-x', 1100); await setInput('layer-y', 10)
  await setInput('add-type', 'loudness'); await click('add-layer')
  await setInput('layer-w', 580); await setInput('layer-h', 440)
  await setInput('layer-x', 30); await setInput('layer-y', 160)
  await setInput('loudness-readout', 'momentary')
  await click('add-layer')
  await setInput('layer-w', 580); await setInput('layer-h', 440)
  await setInput('layer-x', 650); await setInput('layer-y', 160)
  await setInput('loudness-readout', 'integrated')
  await setInput('loudness-target-color', '#b83268')
  await still(1, 'silence.png')
  await still(3, 'tone.png')
  await still(5, 'anti-phase.png')
  await still(7, 'left-only.png')
  await still(8.13, 'pulse.png')
  await still(8.8, 'hold.png')
  await still(9.5, 'decay.png')
  await still(3, 'tone-repeat.png')
  const digest = name => createHash('sha256').update(fs.readFileSync(path.join(DEST, name))).digest('hex')
  assert.equal(digest('tone.png'), digest('tone-repeat.png'), 'Backward seek must reproduce loudness state')
  assert.notEqual(digest('silence.png'), digest('tone.png'))
  await setInput('loudness-readout', 'shortTerm'); await still(3, 'short-term.png')
  assert.notEqual(digest('tone.png'), digest('short-term.png'))
  await setInput('loudness-readout', 'integrated'); await still(3, 'readout-restored.png')
  assert.equal(digest('tone.png'), digest('readout-restored.png'))
  await click('save-project')
  await waitFor('document.querySelector("#status").textContent.includes("Saved project")', 'save project')
  const saved = JSON.parse(fs.readFileSync(process.env.PHASE2_TEST_PROJECT_PATH, 'utf8'))
  assert.deepEqual(saved.layers.filter(layer => layer.type === 'loudness').map(layer =>
    [layer.x, layer.y, layer.w, layer.h, layer.readout]),
  [[30, 160, 580, 440, 'momentary'], [650, 160, 580, 440, 'integrated']])
  await setInput('loudness-readout', 'shortTerm'); await click('open-project')
  await waitFor('document.querySelector("#loudness-readout").value === "integrated"', 'restore readout')
  await still(3, 'tone-reloaded.png')
  assert.equal(digest('tone.png'), digest('tone-reloaded.png'))
  await setInput('layer-w', 540); await still(3, 'resized.png')
  assert.notEqual(digest('tone.png'), digest('resized.png'))
  await setInput('layer-w', 580); await still(3, 'resized-restored.png')
  assert.equal(digest('tone.png'), digest('resized-restored.png'))
  await evaluate('document.querySelector("#export-preset").value="720p"')
  await click('render-mp4')
  await waitFor('document.querySelector("#status").textContent.includes("MP4 ready:")', 'loudness MP4', 300000)
  assert.ok(fs.existsSync(process.env.PHASE2_TEST_OUTPUT_PATH))
  const result = { status: 'PASS', numerical: numbers,
    output: process.env.PHASE2_TEST_OUTPUT_PATH, project: process.env.PHASE2_TEST_PROJECT_PATH }
  fs.writeFileSync(path.join(DEST, 'loudness-smoke.json'), JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify({ event: 'loudness-smoke', ...result }))
  app.quit()
}

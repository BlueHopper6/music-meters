const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { app } = require('electron')
const { defaultProject, vuLayer, normalizeProject } = require('../../phase2/project.cjs')
const { probeAudio } = require('../../phase2/audio.cjs')
const { FIELDS, PREVIEW_PREROLL_FRAMES, analyze, previewVus, precomputeVus } = require('../vu.cjs')

const ROOT = path.resolve(__dirname, '..', '..')
const DEST = path.join(ROOT, 'artifacts', 'phase3', 'vu')
const native = require(path.join(ROOT, 'upstream', 'prism', 'native', 'build', 'Release', 'visualizer_dsp.node')).vumeter
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

function readings(encoded) {
  const bytes = Buffer.from(encoded, 'base64')
  const floats = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4)
  return Array.from({ length: floats.length / FIELDS.length }, (_, index) =>
    Object.fromEntries(FIELDS.map((field, fieldIndex) => [field, floats[index * FIELDS.length + fieldIndex]])))
}

async function numerical(input) {
  const metadata = probeAudio(input)
  const bar = { ...vuLayer('bar', 'Horizontal VU'), x: 30, y: 160, w: 580, h: 440 }
  const needle = { ...vuLayer('needle', 'Needle VU'), x: 650, y: 160, w: 580, h: 440,
    mode: 'needle', needleChannels: 'combined', referenceDb: -20, needleCombinedColor: '#ffaa44' }
  const project = normalizeProject({ ...defaultProject(), audioPath: input, layers: [bar, needle] })
  const samples = {}
  const frames = [30, 63, 75, 90, 150, 210, 244, 265, 270, 285]
  await analyze(input, metadata, metadata.totalFrames - 1, native, () => true,
    (index, values, nativeSnapshot, jsSnapshot) => {
      if (!frames.includes(index)) return
      samples[index] = Object.fromEntries(FIELDS.map((field, offset) => [field, values[offset]]))
      for (const field of ['vuLDb', 'vuRDb', 'barLDb', 'barRDb']) {
        assert.ok(Math.abs(nativeSnapshot[field] - jsSnapshot[field]) < 1.5,
          `Native/JS ${field} differ at frame ${index}: ${nativeSnapshot[field]} vs ${jsSnapshot[field]}`)
      }
      assert.ok(Math.abs(nativeSnapshot.correlation - jsSnapshot.correlation) < .05,
        `Native/JS correlation differs at frame ${index}`)
    }, 'Cancelled')
  assert.equal(samples[30].vuLDb, -60)
  assert.ok(samples[90].vuLDb > -14.4 && samples[90].vuLDb < -13.6)
  assert.ok(Math.abs(samples[90].vuLDb - samples[90].vuRDb) < .1)
  assert.ok(samples[90].correlation > .98)
  assert.ok(samples[150].correlation < -.98)
  assert.ok(samples[210].vuRDb <= -59.9 && samples[210].vuLDb > -14.4)
  assert.ok(samples[63].vuLDb < samples[75].vuLDb - 2, 'VU integration should rise over 300 ms')
  assert.ok(samples[244].peakLDb > -.6 && samples[244].peakLDb < 0)
  assert.ok(samples[265].peakLDb > -1, 'Peak should hold for 750 ms')
  assert.ok(samples[285].peakLDb < samples[265].peakLDb - 3, 'Peak should decay after hold')
  const preview = await previewVus(input, metadata, 270, project, native)
  assert.deepEqual(preview.bar, preview.needle, 'Meters must share the same analysis')
  assert.ok(readings(preview.bar.values).length <= PREVIEW_PREROLL_FRAMES)
  for (const layer of [bar, needle]) {
    const alone = await previewVus(input, metadata, 270,
      normalizeProject({ ...project, layers: [layer] }), native)
    assert.deepEqual(alone[layer.id], preview[layer.id], `${layer.id} depends on another instance`)
  }
  const cache = await precomputeVus(input, metadata, project, native, path.join(DEST, 'parity-cache'), () => true)
  try {
    for (let index = 0; index < metadata.totalFrames; index++) {
      const exported = cache.frame()
      if (index === 270) {
        assert.deepEqual(readings(exported.bar.values)[0], readings(preview.bar.values).at(-1))
        assert.deepEqual(exported.bar, exported.needle)
      }
    }
  } finally { cache.close() }
  return { samples, previewExportFrame: 'exact at frame 270', instances: 'shared analysis, independent settings' }
}

module.exports = async function vuSmoke(win) {
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
  await setInput('layer-w', 160); await setInput('layer-h', 160)
  await setInput('layer-x', 1100); await setInput('layer-y', 10)
  await setInput('add-type', 'vu'); await click('add-layer')
  await setInput('layer-w', 580); await setInput('layer-h', 440)
  await setInput('layer-x', 30); await setInput('layer-y', 160)
  await click('add-layer')
  await setInput('layer-w', 580); await setInput('layer-h', 440)
  await setInput('layer-x', 650); await setInput('layer-y', 160)
  await setInput('vu-mode', 'needle'); await setInput('vu-needle-channels', 'combined')
  await setInput('vu-reference', -20); await setInput('vu-combined-color', '#ffaa44')
  await still(1, 'silence.png')
  await still(3, 'tone.png')
  await still(5, 'anti-phase.png')
  await still(7, 'left-only.png')
  await still(8.13, 'pulse.png')
  await still(8.8, 'hold.png')
  await still(9.5, 'decay.png')
  await still(3, 'tone-repeat.png')
  const digest = name => createHash('sha256').update(fs.readFileSync(path.join(DEST, name))).digest('hex')
  assert.equal(digest('tone.png'), digest('tone-repeat.png'), 'Backward seek must reproduce the VU state')
  assert.notEqual(digest('silence.png'), digest('tone.png'))
  await setInput('vu-needle-channels', 'stereo'); await still(3, 'stereo-needles.png')
  assert.notEqual(digest('tone.png'), digest('stereo-needles.png'))
  await setInput('vu-needle-channels', 'combined'); await still(3, 'tone-style-restored.png')
  assert.equal(digest('tone.png'), digest('tone-style-restored.png'))
  await evaluate('document.querySelector(".layer-item[data-id=vu-1]").click()')
  await setInput('vu-orientation', 'vertical'); await still(3, 'vertical-bar.png')
  assert.notEqual(digest('tone.png'), digest('vertical-bar.png'))
  await setInput('vu-orientation', 'horizontal'); await still(3, 'bar-style-restored.png')
  assert.equal(digest('tone.png'), digest('bar-style-restored.png'))
  await evaluate('document.querySelector(".layer-item[data-id=vu-2]").click()')
  await click('save-project')
  await waitFor('document.querySelector("#status").textContent.includes("Saved project")', 'save project')
  const saved = JSON.parse(fs.readFileSync(process.env.PHASE2_TEST_PROJECT_PATH, 'utf8'))
  assert.deepEqual(saved.layers.filter(layer => layer.type === 'vu').map(layer =>
    [layer.x, layer.y, layer.w, layer.h, layer.mode, layer.referenceDb]),
  [[30, 160, 580, 440, 'bar', -14], [650, 160, 580, 440, 'needle', -20]])
  await setInput('vu-reference', -18); await click('open-project')
  await waitFor('document.querySelector("#vu-reference").value === "-20"', 'restore calibration')
  await still(3, 'tone-reloaded.png')
  assert.equal(digest('tone.png'), digest('tone-reloaded.png'))
  await setInput('layer-w', 540); await still(3, 'resized.png')
  assert.notEqual(digest('tone.png'), digest('resized.png'))
  await setInput('layer-w', 580); await still(3, 'resized-restored.png')
  assert.equal(digest('tone.png'), digest('resized-restored.png'))
  await evaluate('document.querySelector("#export-preset").value="720p"')
  await click('render-mp4')
  await waitFor('document.querySelector("#status").textContent.includes("MP4 ready:")', 'VU MP4', 300000)
  assert.ok(fs.existsSync(process.env.PHASE2_TEST_OUTPUT_PATH))
  const result = { status: 'PASS', numerical: numbers,
    output: process.env.PHASE2_TEST_OUTPUT_PATH, project: process.env.PHASE2_TEST_PROJECT_PATH }
  fs.writeFileSync(path.join(DEST, 'vu-smoke.json'), JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify({ event: 'vu-smoke', ...result }))
  app.quit()
}

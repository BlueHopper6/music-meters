const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { app } = require('electron')
const { defaultProject, spectrogramLayer, normalizeProject } = require('../../phase2/project.cjs')
const { probeAudio } = require('../../phase2/audio.cjs')
const { configuration, previewSpectrograms, precomputeSpectrograms } = require('../spectrogram.cjs')

const ROOT = path.resolve(__dirname, '..', '..')
const DEST = path.join(ROOT, 'artifacts', 'phase3', 'spectrogram')
const native = require(path.join(ROOT, 'upstream', 'prism', 'native', 'build', 'Release', 'visualizer_dsp.node')).spectrogram
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

function floats(encoded) {
  const bytes = Buffer.from(encoded, 'base64')
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4)
}

function peak(entry) {
  const values = floats(entry.display)
  const last = values.subarray(Math.max(0, values.length - entry.rowCount))
  return { row: last.indexOf(Math.max(...last)), value: Math.max(...last) }
}

async function numerical(input) {
  const metadata = probeAudio(input)
  const horizontal = { ...spectrogramLayer('horizontal', 'Horizontal'),
    x: 40, y: 170, w: 570, h: 450, fftSize: 1024 }
  const vertical = { ...spectrogramLayer('vertical', 'Vertical'),
    x: 650, y: 170, w: 570, h: 450, fftSize: 1024,
    scaleMode: 'mel', orientation: 'vertical', colorScheme: 'mono' }
  const project = normalizeProject({ ...defaultProject(), audioPath: input,
    layers: [horizontal, vertical] })
  const at = frame => previewSpectrograms(input, metadata, frame, project, native)
  const silence = await at(30)
  const low = await at(105)
  const anti = await at(165)
  const left = await at(225)
  const transition = await at(243)
  const high = await at(270)
  const latest = (data, id) => data[id].entries.at(-1)
  const silencePeak = peak(latest(silence, 'horizontal')).value
  const lowPeak = peak(latest(low, 'horizontal'))
  const antiPeak = peak(latest(anti, 'horizontal'))
  const leftPeak = peak(latest(left, 'horizontal'))
  const highPeak = peak(latest(high, 'horizontal'))
  assert.ok(silencePeak < 0.01, `Silence produced bright columns: ${silencePeak}`)
  assert.ok(lowPeak.value > 0.1 && antiPeak.value > 0.1 && leftPeak.value > 0.1,
    'All 440 Hz stereo relations must retain spectrogram energy')
  assert.ok(highPeak.value > 0.1 && highPeak.row !== lowPeak.row,
    '1 kHz tone must move to a different frequency row')
  const transitionRows = new Set(transition.horizontal.entries
    .filter(entry => entry.columnCount > 0).map(entry => peak(entry).row))
  assert.ok(transitionRows.has(lowPeak.row) && transitionRows.has(highPeak.row),
    'Scrolling history must retain both old and new tone rows during a frequency change')
  assert.ok(latest(low, 'horizontal').rowCount === 450 && latest(low, 'vertical').rowCount === 570)
  assert.equal(configuration(horizontal, 1.5, metadata.sampleRate).rowCount, 675)
  assert.equal(configuration(vertical, 1.5, metadata.sampleRate).rowCount, 855)
  const horizontalAlone = await previewSpectrograms(input, metadata, 105,
    normalizeProject({ ...project, layers: [horizontal] }), native)
  const verticalAlone = await previewSpectrograms(input, metadata, 105,
    normalizeProject({ ...project, layers: [vertical] }), native)
  for (const [id, alone] of [['horizontal', horizontalAlone], ['vertical', verticalAlone]]) {
    assert.deepEqual(alone[id].entries, low[id].entries,
      `${id} native history changed in the presence of another spectrogram`)
  }
  const linear = { ...horizontal, id: 'linear', scaleMode: 'linear' }
  const linearProject = normalizeProject({ ...project, layers: [linear] })
  const linearLow = await previewSpectrograms(input, metadata, 105, linearProject, native)
  const linearHigh = await previewSpectrograms(input, metadata, 270, linearProject, native)
  const linearRows = [peak(latest(linearLow, 'linear')).row, peak(latest(linearHigh, 'linear')).row]
  assert.ok(linearRows[0] !== linearRows[1] && peak(latest(linearLow, 'linear')).value > 0.1,
    'Linear scale must retain and separate both tones')
  const slow = { ...horizontal, id: 'slow', scrollSpeed: 1 }
  const fast = { ...horizontal, id: 'fast', scrollSpeed: 4 }
  const slowData = await previewSpectrograms(input, metadata, 105,
    normalizeProject({ ...project, layers: [slow] }), native)
  const fastData = await previewSpectrograms(input, metadata, 105,
    normalizeProject({ ...project, layers: [fast] }), native)
  const speedColumns = [latest(slowData, 'slow').columnCount, latest(fastData, 'fast').columnCount]
  assert.ok(speedColumns[1] > speedColumns[0],
    `Faster scroll must generate more native columns per frame: ${speedColumns}`)
  const cache = await precomputeSpectrograms(input, metadata, project, native,
    path.join(DEST, 'parity-cache'), 1, () => true)
  try {
    for (let frame = 0; frame <= 270; frame++) {
      const data = cache.frame()
      if ([105, 165, 225, 270].includes(frame)) {
        const reference = { 105: low, 165: anti, 225: left, 270: high }[frame]
        for (const id of ['horizontal', 'vertical']) {
          assert.deepEqual(data[id].entries[0], latest(reference, id),
            `Preview/export native columns differ at frame ${frame} for ${id}`)
        }
      }
    }
  } finally { cache.close() }
  return { silencePeak, lowPeak, antiPeak, leftPeak, highPeak,
    transitionRows: [...transitionRows].sort((a, b) => a - b), linearRows, speedColumns,
    rowCounts: [450, 570], previewExportColumns: 'exact at 105, 165, 225, 270' }
}

module.exports = async function spectrogramSmoke(win) {
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
  await setInput('layer-w', 150)
  await setInput('layer-h', 150)
  await setInput('layer-x', 1100)
  await setInput('layer-y', 12)
  await setInput('add-type', 'spectrogram')
  await click('add-layer')
  await setInput('layer-w', 570)
  await setInput('layer-h', 450)
  await setInput('layer-x', 40)
  await setInput('layer-y', 170)
  await setInput('spectrogram-fft', 1024)
  await click('add-layer')
  await setInput('layer-w', 570)
  await setInput('layer-h', 450)
  await setInput('layer-x', 650)
  await setInput('layer-y', 170)
  await setInput('spectrogram-fft', 1024)
  await setInput('spectrogram-scale', 'mel')
  await setInput('spectrogram-orientation', 'vertical')
  await setInput('spectrogram-color', 'mono')
  await setCheck('spectrogram-grid', false)
  await still(1, 'silence.png')
  await still(3, 'in-phase.png')
  await still(5, 'anti-phase.png')
  await still(7, 'left-only.png')
  await still(8.1, 'transition.png')
  await still(9, 'one-khz.png')
  await still(3, 'in-phase-repeat.png')
  const digest = name => createHash('sha256').update(fs.readFileSync(path.join(DEST, name))).digest('hex')
  assert.equal(digest('in-phase.png'), digest('in-phase-repeat.png'), 'Backward seek must reproduce history')
  assert.notEqual(digest('silence.png'), digest('in-phase.png'))
  await click('save-project')
  await waitFor('document.querySelector("#status").textContent.includes("Saved project")', 'save project')
  const saved = JSON.parse(fs.readFileSync(process.env.PHASE2_TEST_PROJECT_PATH, 'utf8'))
  assert.deepEqual(saved.layers.filter(layer => layer.type === 'spectrogram').map(layer =>
    [layer.x, layer.y, layer.w, layer.h, layer.orientation, layer.scaleMode, layer.colorScheme]),
  [[40, 170, 570, 450, 'horizontal', 'log', 'heat'],
    [650, 170, 570, 450, 'vertical', 'mel', 'mono']])
  await setInput('spectrogram-orientation', 'horizontal')
  await click('open-project')
  await waitFor('document.querySelector("#spectrogram-orientation").value === "vertical"', 'restore orientation')
  await still(3, 'in-phase-reloaded.png')
  assert.equal(digest('in-phase.png'), digest('in-phase-reloaded.png'))
  await setInput('layer-w', 540)
  await still(3, 'resized.png')
  assert.notEqual(digest('resized.png'), digest('in-phase.png'), 'Resize must change the composition')
  await setInput('layer-w', 570)
  await still(3, 'resized-restored.png')
  assert.equal(digest('in-phase.png'), digest('resized-restored.png'),
    'Restoring geometry must recompute the correct frequency rows and history')
  await evaluate('document.querySelector("#export-preset").value="720p"')
  await evaluate('window.__smokeBusy=document.querySelector("#preview-busy"); window.__smokeBusy.remove()')
  if (!win.isVisible()) win.showInactive()
  win.webContents.invalidate()
  await delay(500)
  fs.writeFileSync(path.join(DEST, 'editor-window.png'), (await win.capturePage()).toPNG())
  await evaluate('document.querySelector("#stage-wrap").append(window.__smokeBusy); delete window.__smokeBusy')
  if (process.env.PHASE2_HEADLESS === '1') win.hide()
  await click('render-mp4')
  await waitFor('document.querySelector("#status").textContent.includes("MP4 ready:")', 'spectrogram MP4', 300000)
  assert.ok(fs.existsSync(process.env.PHASE2_TEST_OUTPUT_PATH))
  const result = { status: 'PASS', numerical: numbers,
    output: process.env.PHASE2_TEST_OUTPUT_PATH, project: process.env.PHASE2_TEST_PROJECT_PATH }
  fs.writeFileSync(path.join(DEST, 'spectrogram-smoke.json'), JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify({ event: 'spectrogram-smoke', ...result }))
  app.quit()
}

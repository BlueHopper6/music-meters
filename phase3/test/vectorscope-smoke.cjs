const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { app } = require('electron')
const { probeAudio, analyzeFrame } = require('../../phase2/audio.cjs')
const { vectorscopeCorrelations } = require('../vectorscope-correlation.cjs')

const ROOT = path.resolve(__dirname, '..', '..')
const DEST = path.join(ROOT, 'artifacts', 'phase3', 'vectorscope')
const native = require(path.join(ROOT, 'upstream', 'prism', 'native', 'build', 'Release', 'visualizer_dsp.node')).vectorscope
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const floats = encoded => {
  const bytes = Buffer.from(encoded, 'base64')
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4)
}
function rmsBands(data) {
  const sums = [0, 0, 0]
  const count = data.length / 6
  for (let index = 0; index < count; index++) {
    for (let band = 0; band < 3; band++) sums[band] += data[index * 6 + band * 2] ** 2
  }
  return sums.map(sum => Math.sqrt(sum / count))
}
async function numerical(input) {
  const metadata = probeAudio(input)
  const at = async (file, frame) => {
    const data = await analyzeFrame(file, probeAudio(file), frame, native, () => true, true)
    const x = floats(data.x), y = floats(data.y), bands = floats(data.multiband)
    assert.equal(x.length, 1024)
    assert.equal(y.length, 1024)
    assert.equal(bands.length, 6144)
    return { correlation: vectorscopeCorrelations(x, y, bands), energy: rmsBands(bands) }
  }
  const silence = await at(input, 30), phase = await at(input, 105)
  const anti = await at(input, 165), left = await at(input, 225)
  const high = await at(input, 270)
  assert.equal(silence.correlation.overall, 0)
  assert.ok(phase.correlation.overall > 0.999 && phase.correlation.bands.every(value => value > 0.99))
  assert.ok(anti.correlation.overall < -0.999 && anti.correlation.bands.every(value => value < -0.99))
  assert.equal(left.correlation.overall, 0)
  assert.ok(left.correlation.bands.every(value => Math.abs(value) < 0.01))
  assert.ok(high.correlation.overall > 0.999)
  const frequencyFixture = path.join(ROOT, 'artifacts', 'phase3', 'waveform-10s-48k.wav')
  const lowTone = await at(frequencyFixture, 105), highTone = await at(frequencyFixture, 270)
  assert.ok(lowTone.energy[0] > lowTone.energy[1] * 2 && lowTone.energy[0] > lowTone.energy[2] * 5,
    `100 Hz should favor low band: ${lowTone.energy}`)
  assert.ok(highTone.energy[2] > highTone.energy[0] * 5 && highTone.energy[2] > highTone.energy[1] * 2,
    `5 kHz should favor high band: ${highTone.energy}`)
  const sampleRates = {}
  for (const [rate, name] of [[44100, '44k1'], [96000, '96k']]) {
    const variant = path.join(ROOT, 'artifacts', 'phase3', `spectrum-10s-${name}.wav`)
    const result = await at(variant, 105)
    assert.ok(result.correlation.overall > 0.999)
    sampleRates[rate] = result.correlation.overall
  }
  return { silence: silence.correlation, inPhase: phase.correlation,
    antiPhase: anti.correlation, leftOnly: left.correlation,
    oneKHz: high.correlation, lowBandEnergy: lowTone.energy,
    highBandEnergy: highTone.energy, sampleRates, sourceRate: metadata.sampleRate }
}

module.exports = async function vectorscopeSmoke(win) {
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
  const click = id => evaluate(`document.getElementById(${JSON.stringify(id)}).click()`)
  const setInput = (id, value) => evaluate(`(() => { const input=document.getElementById(${JSON.stringify(id)}); input.value=${JSON.stringify(String(value))}; input.dispatchEvent(new Event('change',{bubbles:true})); return true })()`)
  const setCheck = (id, checked) => evaluate(`(() => { const input=document.getElementById(${JSON.stringify(id)}); input.checked=${JSON.stringify(checked)}; input.dispatchEvent(new Event('change',{bubbles:true})); return true })()`)
  async function still(seconds, name) {
    await setInput('time-input', seconds)
    await waitFor(`document.querySelector('#status').textContent.includes('${seconds.toFixed(2)} s') && document.querySelector('#status').textContent.includes('Real Prism') && document.querySelector('#preview-busy').hidden`, name)
    const data = await evaluate('document.querySelector("#stage").toDataURL("image/png").split(",")[1]')
    fs.writeFileSync(path.join(DEST, name), Buffer.from(data, 'base64'))
  }
  const digest = name => createHash('sha256').update(fs.readFileSync(path.join(DEST, name))).digest('hex')
  const crop = (x, y) => evaluate(`(() => { const source=document.getElementById('stage'); const target=document.createElement('canvas'); target.width=570; target.height=440; target.getContext('2d').drawImage(source,${x},${y},570,440,0,0,570,440); return target.toDataURL('image/png') })()`)
  const select = id => evaluate(`document.querySelector('.layer-item[data-id=${JSON.stringify(id)}]').click()`)

  await waitFor('document.querySelector("#status").textContent.includes("Real Prism")', 'initial still')
  const numbers = await numerical(input)
  await setInput('layer-w', 570); await setInput('layer-h', 440)
  await setInput('layer-x', 40); await setInput('layer-y', 170)
  await setCheck('vectorscope-correlation', true)
  await setInput('vectorscope-zoom', 6)
  const modes = ['lissajous', 'polar-unipolar', 'polar-bipolar', 'linear-unipolar', 'linear-bipolar']
  for (const mode of modes) {
    await setInput('vectorscope-mode', mode)
    await still(3.5, `mode-${mode}.png`)
  }
  assert.equal(new Set(modes.map(mode => digest(`mode-${mode}.png`))).size, modes.length,
    'All projection modes must draw distinct stills')
  await setInput('vectorscope-mode', 'polar-bipolar')
  await setInput('add-type', 'vectorscope'); await click('add-layer')
  await setInput('layer-w', 570); await setInput('layer-h', 440)
  await setInput('layer-x', 650); await setInput('layer-y', 170)
  await setInput('vectorscope-mode', 'linear-bipolar')
  await setInput('vectorscope-zoom', -3)
  await setInput('vectorscope-low-color', '#ff3322')
  await setInput('vectorscope-mid-color', '#55ee44')
  await setInput('vectorscope-high-color', '#3377ff')
  await setCheck('vectorscope-correlation', true)
  await setCheck('vectorscope-multiband', true)
  await still(1, 'silence.png')
  await still(3.5, 'tone.png')
  const bothA = await crop(40, 170), bothB = await crop(650, 170)
  await setCheck('layer-visible', false)
  await still(3.5, 'first-only.png')
  assert.equal(await crop(40, 170), bothA, 'First projection changed with the second hidden')
  await setCheck('layer-visible', true)
  await waitFor('document.querySelector("#status").textContent.includes("Real Prism") && document.querySelector("#preview-busy").hidden', 'second restored')
  await select('scope-1')
  await setCheck('layer-visible', false)
  await still(3.5, 'second-only.png')
  assert.equal(await crop(650, 170), bothB, 'Second projection changed with the first hidden')
  await setCheck('layer-visible', true)
  await still(5.5, 'anti-phase.png')
  await still(7.5, 'left-only.png')
  await still(9, 'one-khz.png')
  await still(3.5, 'tone-repeat.png')
  assert.equal(digest('tone.png'), digest('tone-repeat.png'), 'Backward seek must reproduce both scopes')
  assert.notEqual(digest('silence.png'), digest('tone.png'))
  await click('save-project')
  await waitFor('document.querySelector("#status").textContent.includes("Saved project")', 'save project')
  const saved = JSON.parse(fs.readFileSync(process.env.PHASE2_TEST_PROJECT_PATH, 'utf8'))
  assert.deepEqual(saved.layers.map(layer => [layer.type, layer.mode, layer.zoomDb, layer.multiband, layer.showCorrelation]),
    [['vectorscope', 'polar-bipolar', 6, false, true], ['vectorscope', 'linear-bipolar', -3, true, true]])
  await setInput('vectorscope-mode', 'linear-unipolar')
  await click('open-project')
  await waitFor('document.querySelector("#vectorscope-mode").value === "linear-bipolar"', 'restore projection')
  await still(3.5, 'tone-reloaded.png')
  assert.equal(digest('tone.png'), digest('tone-reloaded.png'))
  await setInput('layer-w', 540); await still(3.5, 'resized.png')
  assert.notEqual(digest('tone.png'), digest('resized.png'))
  await setInput('layer-w', 570); await still(3.5, 'resized-restored.png')
  assert.equal(digest('tone.png'), digest('resized-restored.png'))
  await evaluate('document.querySelector("#export-preset").value="720p"')
  await click('render-mp4')
  await waitFor('document.querySelector("#status").textContent.includes("MP4 ready:")', 'vectorscope MP4')
  assert.ok(fs.existsSync(process.env.PHASE2_TEST_OUTPUT_PATH))
  const result = { status: 'PASS', numerical: numbers,
    output: process.env.PHASE2_TEST_OUTPUT_PATH, project: process.env.PHASE2_TEST_PROJECT_PATH }
  fs.writeFileSync(path.join(DEST, 'vectorscope-smoke.json'), JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify({ event: 'vectorscope-smoke', ...result }))
  app.quit()
}

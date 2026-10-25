const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { app } = require('electron')

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

module.exports = async function repeatSmoke(win) {
  const dir = process.env.PHASE6_REPEAT_DIR
  const evaluate = expression => win.webContents.executeJavaScript(expression)
  async function waitFor(expression, label) {
    const deadline = Date.now() + 120000
    while (Date.now() < deadline) {
      if (await evaluate(expression)) return
      await delay(100)
    }
    throw new Error(`Timed out waiting for ${label}`)
  }
  await evaluate(`(() => { const input = document.getElementById('time-input'); input.value = '1';
    input.dispatchEvent(new Event('change', { bubbles: true })); return true })()`)
  await waitFor('document.querySelector("#status").textContent.includes("Real Prism meter still at 1.00 s") && document.querySelector("#preview-busy").hidden', 'real preview')
  await delay(500)
  const stageControls = await evaluate(`(() => {
    const selection = document.getElementById('selection')
    const stage = document.getElementById('stage-wrap').getBoundingClientRect()
    const bounds = selection.getBoundingClientRect()
    selection.setPointerCapture = () => {}
    document.getElementById('snap-enabled').checked = true
    document.getElementById('snap-grid').value = '32'
    const x = bounds.left + bounds.width / 2
    const y = bounds.top + bounds.height / 2
    selection.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientX: x, clientY: y }))
    selection.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1,
      clientX: x, clientY: y - 58 * stage.height / 720 }))
    const guided = !document.getElementById('snap-guide-y').hidden
    selection.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }))
    const cleared = document.getElementById('snap-guide-y').hidden
    const aspect = document.getElementById('layer-aspect-lock')
    aspect.checked = true; aspect.dispatchEvent(new Event('change', { bubbles: true }))
    const width = document.getElementById('layer-w')
    width.value = '540'; width.dispatchEvent(new Event('change', { bubbles: true }))
    const scaledHeight = document.getElementById('layer-h').value
    width.value = '500'; width.dispatchEvent(new Event('change', { bubbles: true }))
    return { y: document.getElementById('layer-y').value, guided, cleared, scaledHeight,
      restoredHeight: document.getElementById('layer-h').value }
  })()`)
  assert.deepEqual(stageControls, { y: '110', guided: true, cleared: true, scaledHeight: '540', restoredHeight: '500' })
  const baseline = await evaluate('document.getElementById("stage").toDataURL("image/png").split(",")[1]')
  await evaluate(`(() => { const input = document.getElementById('layer-rotation'); input.value = '90';
    input.dispatchEvent(new Event('change', { bubbles: true })); return true })()`)
  const still = await evaluate('document.getElementById("stage").toDataURL("image/png").split(",")[1]')
  assert.notEqual(createHash('sha256').update(baseline).digest('hex'),
    createHash('sha256').update(still).digest('hex'), 'meter rotation should change the still')
  assert.equal(await evaluate('document.getElementById("layer-rotation").value'), '90')
  fs.writeFileSync(path.join(dir, 'editor-still.png'), Buffer.from(still, 'base64'))
  fs.writeFileSync(path.join(dir, 'editor.png'), (await win.capturePage()).toPNG())
  await evaluate('document.getElementById("export-preset").value = "720p"')
  await evaluate('document.getElementById("render-mp4").click()')
  await waitFor('document.querySelector("#status").textContent.includes("MP4 ready:")', 'first export')
  const first = process.env.PHASE2_TEST_OUTPUT_PATH
  assert.ok(fs.existsSync(first))
  const second = path.join(dir, 'second-export.mp4')
  process.env.PHASE2_TEST_OUTPUT_PATH = second
  await evaluate('document.getElementById("render-mp4").click()')
  const deadline = Date.now() + 120000
  while (!fs.existsSync(second) && Date.now() < deadline) await delay(100)
  assert.ok(fs.existsSync(second))
  await waitFor('document.querySelector("#status").textContent.includes("MP4 ready:")', 'second export')
  console.log(JSON.stringify({ event: 'repeat-export-pass', first, second }))
  app.quit()
}

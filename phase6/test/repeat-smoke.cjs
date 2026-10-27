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
  await waitFor('document.getElementById("stage").dataset.previewFrame === "30" && document.getElementById("playback-cancel").hidden', 'fast seek')
  await evaluate('document.getElementById("refresh-still").click()')
  await waitFor('document.querySelector("#status").textContent.includes("Real Prism meter still at 1.00 s") && document.querySelector("#preview-busy").hidden', 'real preview')
  await delay(500)
  async function stageClick(stageX, stageY) {
    const point = await evaluate(`(() => { const r = document.getElementById('stage').getBoundingClientRect();
      return { x: Math.round(r.left + ${stageX} * r.width / 1280),
        y: Math.round(r.top + ${stageY} * r.height / 720) } })()`)
    win.webContents.sendInputEvent({ type: 'mouseMove', ...point })
    win.webContents.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 })
    win.webContents.sendInputEvent({ type: 'mouseUp', ...point, button: 'left', clickCount: 1 })
    await delay(100)
  }
  await stageClick(30, 690)
  const cleared = await evaluate(`(() => ({ outline: document.getElementById('selection').hidden,
    selectedRows: document.querySelectorAll('.layer-item.selected').length,
    emptyHint: !document.getElementById('no-layer-selected').hidden,
    controlsHidden: document.getElementById('selected-layer-controls').hidden,
    actionsDisabled: ['duplicate-layer', 'delete-layer', 'layer-up', 'layer-down']
      .every(id => document.getElementById(id).disabled),
    backgroundEnabled: !document.getElementById('background').disabled,
    yLabel: document.getElementById('layer-y').parentElement.textContent.trim() }))()`)
  assert.deepEqual(cleared, { outline: true, selectedRows: 0, emptyHint: true,
    controlsHidden: true, actionsDisabled: true, backgroundEnabled: true, yLabel: 'Y (from top)' })
  if (!win.isVisible()) win.showInactive()
  win.webContents.invalidate()
  await delay(500)
  fs.writeFileSync(path.join(dir, 'editor-clean-preview.png'), (await win.capturePage()).toPNG())
  await stageClick(640, 420)
  assert.equal(await evaluate('document.getElementById("selection").hidden'), false)
  await evaluate(`(() => { const stage = document.getElementById('stage'); stage.focus();
    stage.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return true })()`)
  assert.equal(await evaluate('document.getElementById("selection").hidden'), true)
  await evaluate(`(() => { const row = document.querySelector('.layer-item'); row.focus();
    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); return true })()`)
  assert.equal(await evaluate('document.getElementById("selection").hidden'), false)
  await evaluate('document.getElementById("fullscreen-preview").click()')
  assert.equal(await evaluate('document.body.classList.contains("stage-fullscreen") && getComputedStyle(document.getElementById("selection")).opacity === "0"'), true)
  await evaluate('document.getElementById("exit-fullscreen-preview").click()')
  assert.equal(await evaluate('document.body.classList.contains("stage-fullscreen")'), false)
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
  const resized = await evaluate(`(() => {
    const selection = document.getElementById('selection')
    const handle = selection.querySelector('.resize-handle')
    const box = handle.getBoundingClientRect()
    const stage = document.getElementById('stage-wrap').getBoundingClientRect()
    const x = box.left + box.width / 2
    const y = box.top + box.height / 2
    handle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 2, clientX: x, clientY: y }))
    selection.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 2,
      clientX: x + 60 * stage.width / 1280, clientY: y + 60 * stage.height / 720 }))
    selection.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 2 }))
    const width = Number(document.getElementById('layer-w').value)
    const height = Number(document.getElementById('layer-h').value)
    const input = document.getElementById('layer-w')
    input.value = '500'; input.dispatchEvent(new Event('change', { bubbles: true }))
    return { width, height, restored: Number(document.getElementById('layer-w').value) }
  })()`)
  assert.ok(resized.width > 500 && resized.height === resized.width && resized.restored === 500,
    `Resize handle failed with aspect lock: ${JSON.stringify(resized)}`)
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
  await evaluate('document.getElementById("open-export").click(); document.getElementById("render-mp4").click()')
  await waitFor('document.querySelector("#status").textContent.includes("MP4 ready:")', 'first export')
  const first = process.env.PHASE2_TEST_OUTPUT_PATH
  assert.ok(fs.existsSync(first))
  const second = path.join(dir, 'second-export.mp4')
  process.env.PHASE2_TEST_OUTPUT_PATH = second
  await evaluate('document.getElementById("open-export").click(); document.getElementById("render-mp4").click()')
  const deadline = Date.now() + 120000
  while (!fs.existsSync(second) && Date.now() < deadline) await delay(100)
  assert.ok(fs.existsSync(second))
  await waitFor('document.querySelector("#status").textContent.includes("MP4 ready:")', 'second export')
  const cancelled = path.join(dir, 'cancelled-export.mp4')
  process.env.PHASE2_TEST_OUTPUT_PATH = cancelled
  await evaluate('document.getElementById("open-export").click(); document.getElementById("render-mp4").click()')
  await waitFor('/^Rendering \\d+\\//.test(document.getElementById("status").textContent)', 'frames rendering before cancellation')
  await evaluate('document.getElementById("cancel-render").click()')
  await waitFor('document.getElementById("status").textContent === "Export cancelled. No video was saved."', 'clean cancellation status')
  assert.equal(fs.existsSync(cancelled), false, 'Cancellation must not leave a final video')
  assert.equal(fs.readdirSync(dir).some(name => name.startsWith('cancelled-export.mp4.partial-')), false,
    'Cancellation must remove partial video files')
  assert.equal(await evaluate('document.getElementById("render-mp4").disabled'), false)
  const recovered = path.join(dir, 'after-cancel-export.mp4')
  process.env.PHASE2_TEST_OUTPUT_PATH = recovered
  await evaluate('document.getElementById("open-export").click(); document.getElementById("render-mp4").click()')
  await waitFor('document.getElementById("status").textContent.includes("MP4 ready:")', 'successful export after cancellation')
  assert.ok(fs.existsSync(recovered))
  await evaluate('document.getElementById("save-project").click()')
  await waitFor('document.querySelector("#status").textContent.includes("Saved project:")', 'project save')
  const saved = JSON.parse(fs.readFileSync(process.env.PHASE2_TEST_PROJECT_PATH, 'utf8'))
  assert.equal(saved.layers[0].y, 110)
  await stageClick(30, 690)
  assert.equal(await evaluate('document.getElementById("selection").hidden'), true)
  await evaluate('document.getElementById("open-project").click()')
  await waitFor('document.getElementById("no-layer-selected").hidden && document.getElementById("layer-y").value === "110"', 'project reload')
  assert.equal(await evaluate('document.getElementById("layer-y").value'), '110')
  await stageClick(30, 690)
  await evaluate('document.getElementById("load-template").click()')
  await waitFor('document.querySelectorAll(".layer-item").length > 0 && document.getElementById("no-layer-selected").hidden', 'template load')
  assert.equal(await evaluate('document.getElementById("selection").hidden'), false)
  const order = await evaluate('Array.from(document.querySelectorAll(".layer-item"), row => row.dataset.id)')
  assert.ok(order.length > 1, 'Starter template should have multiple layers')
  await evaluate('document.getElementById("layer-down").click()')
  assert.notDeepEqual(await evaluate('Array.from(document.querySelectorAll(".layer-item"), row => row.dataset.id)'), order)
  await evaluate('document.getElementById("layer-up").click()')
  assert.deepEqual(await evaluate('Array.from(document.querySelectorAll(".layer-item"), row => row.dataset.id)'), order)
  console.log(JSON.stringify({ event: 'repeat-export-pass', first, second, recovered, cancellation: 'PASS' }))
  app.quit()
}

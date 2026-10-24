const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { app } = require('electron')

const ROOT = path.resolve(__dirname, '..', '..')
const DEST = path.join(ROOT, 'artifacts', 'phase2')
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

module.exports = async function editorSmoke(win) {
  fs.mkdirSync(DEST, { recursive: true })
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
  async function click(id) {
    await evaluate(`document.getElementById(${JSON.stringify(id)}).click()`)
  }
  async function saveCanvas(name) {
    const data = await evaluate('document.querySelector("#stage").toDataURL("image/png").split(",")[1]')
    fs.writeFileSync(path.join(DEST, name), Buffer.from(data, 'base64'))
  }

  await waitFor('document.querySelector("#status").textContent.includes("Real Prism")', 'initial real audio still')
  const initial = await evaluate('({ layers: document.querySelectorAll(".layer-item").length, audio: document.querySelector("#audio-name").textContent })')
  assert.equal(initial.layers, 1)
  assert.match(initial.audio, /stereo-10s-48k/)
  await saveCanvas('preview-0.png')
  await setInput('time-input', '5')
  await waitFor('document.querySelector("#status").textContent.includes("5.00 s") && document.querySelector("#status").textContent.includes("Real Prism")', 'five-second still')
  await saveCanvas('preview-5-before-edits.png')
  await setInput('time-input', '8.33')
  await waitFor('document.querySelector("#status").textContent.includes("8.33 s") && document.querySelector("#status").textContent.includes("Real Prism")', 'anti-phase still')
  await saveCanvas('preview-8.33.png')
  await setInput('time-input', '5')
  await waitFor('document.querySelector("#status").textContent.includes("5.00 s") && document.querySelector("#status").textContent.includes("Real Prism")', 'backward seek still')
  await saveCanvas('preview-5-repeat.png')
  const digest = name => createHash('sha256').update(fs.readFileSync(path.join(DEST, name))).digest('hex')
  assert.equal(digest('preview-5-before-edits.png'), digest('preview-5-repeat.png'))
  assert.notEqual(digest('preview-0.png'), digest('preview-5-before-edits.png'))
  assert.notEqual(digest('preview-8.33.png'), digest('preview-5-before-edits.png'))
  await evaluate('(() => { const title=document.querySelector("#title"); title.value="Stereo Phase Study"; title.dispatchEvent(new Event("input",{bubbles:true})); const background=document.querySelector("#background"); background.value="#15233b"; background.dispatchEvent(new Event("input",{bubbles:true})); return true })()')

  await click('add-layer')
  assert.equal(await evaluate('document.querySelectorAll(".layer-item").length'), 2)
  await click('duplicate-layer')
  assert.equal(await evaluate('document.querySelectorAll(".layer-item").length'), 3)
  const order = await evaluate('Array.from(document.querySelectorAll(".layer-item"), item => item.dataset.id)')
  await click('layer-down')
  const lowerOrder = await evaluate('Array.from(document.querySelectorAll(".layer-item"), item => item.dataset.id)')
  assert.notDeepEqual(lowerOrder, order)
  await click('layer-up')
  assert.deepEqual(await evaluate('Array.from(document.querySelectorAll(".layer-item"), item => item.dataset.id)'), order)
  await click('delete-layer')
  assert.equal(await evaluate('document.querySelectorAll(".layer-item").length'), 2)

  await setInput('layer-x', '270')
  await setInput('layer-y', '190')
  await setInput('layer-w', '420')
  await setInput('layer-h', '360')
  assert.equal(await evaluate('Number(document.querySelector("#layer-x").value)'), 270)
  assert.equal(await evaluate('Number(document.querySelector("#layer-w").value)'), 420)

  await evaluate('(() => { const input=document.querySelector("#layer-visible"); input.checked=false; input.dispatchEvent(new Event("change",{bubbles:true})); return true })()')
  assert.equal(await evaluate('document.querySelector("#selection").hidden'), true)
  await evaluate('(() => { const input=document.querySelector("#layer-visible"); input.checked=true; input.dispatchEvent(new Event("change",{bubbles:true})); return true })()')
  await evaluate('(() => { const input=document.querySelector("#layer-locked"); input.checked=true; input.dispatchEvent(new Event("change",{bubbles:true})); return true })()')
  assert.equal(await evaluate('document.querySelector("#layer-x").disabled'), true)
  await evaluate('(() => { const input=document.querySelector("#layer-locked"); input.checked=false; input.dispatchEvent(new Event("change",{bubbles:true})); return true })()')
  await setInput('layer-opacity', '70')
  assert.equal(await evaluate('Number(document.querySelector("#layer-opacity").value)'), 70)

  async function pointerEdit(selector, dx, dy) {
    const box = await evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x:r.x+r.width/2, y:r.y+r.height/2 } })()`)
    const x = Math.round(box.x)
    const y = Math.round(box.y)
    win.webContents.sendInputEvent({ type: 'mouseMove', x, y })
    win.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 })
    win.webContents.sendInputEvent({ type: 'mouseMove', x: x + dx, y: y + dy })
    win.webContents.sendInputEvent({ type: 'mouseUp', x: x + dx, y: y + dy, button: 'left', clickCount: 1 })
    await delay(120)
  }
  await pointerEdit('#selection', 28, 12)
  const firstDraggedX = await evaluate('Number(document.querySelector("#layer-x").value)')
  assert.ok(firstDraggedX > 270, `Expected pointer drag to move layer, got X=${firstDraggedX}`)
  await pointerEdit('#selection', 20, 10)
  const draggedX = await evaluate('Number(document.querySelector("#layer-x").value)')
  assert.ok(draggedX > firstDraggedX, `Expected second pointer drag to move layer, got X=${draggedX}`)

  await pointerEdit('.resize-handle', 35, 25)
  const firstResizedW = await evaluate('Number(document.querySelector("#layer-w").value)')
  assert.ok(firstResizedW > 420, `Expected pointer resize to grow layer, got width=${firstResizedW}`)
  await pointerEdit('.resize-handle', 20, 10)
  const resizedW = await evaluate('Number(document.querySelector("#layer-w").value)')
  assert.ok(resizedW > firstResizedW, `Expected second pointer resize to grow layer, got width=${resizedW}`)

  await click('save-project')
  await waitFor('document.querySelector("#status").textContent.includes("Saved project")', 'project save')
  const saved = JSON.parse(fs.readFileSync(process.env.PHASE2_TEST_PROJECT_PATH, 'utf8'))
  assert.equal(saved.layers.length, 2)
  assert.equal(saved.title, 'Stereo Phase Study')
  assert.equal(saved.background, '#15233b')
  assert.equal(saved.layers.at(-1).w, resizedW)
  assert.equal(saved.layers.at(-1).opacity, 0.7)
  assert.ok(saved.audioRelativePath && !path.isAbsolute(saved.audioRelativePath))
  await setInput('layer-x', '35')
  await click('open-project')
  await waitFor(`Number(document.querySelector("#layer-x").value) === ${saved.layers.at(-1).x}`, 'project reload')
  await waitFor('document.querySelector("#status").textContent.includes("Real Prism")', 'reloaded still')
  await setInput('time-input', '5')
  await waitFor('document.querySelector("#status").textContent.includes("5.00 s") && document.querySelector("#status").textContent.includes("Real Prism") && document.querySelector("#preview-busy").hidden', 'final still')
  await saveCanvas('preview-5.png')
  await evaluate('document.querySelector("#export-preset").value = "720p"')
  await evaluate('window.__smokeBusy = document.querySelector("#preview-busy"); window.__smokeBusy.remove()')
  if (!win.isVisible()) win.showInactive()
  win.webContents.invalidate()
  await delay(500)
  const screenshot = await win.capturePage()
  fs.writeFileSync(path.join(DEST, 'editor-window.png'), screenshot.toPNG())
  await evaluate('document.querySelector("#stage-wrap").append(window.__smokeBusy); delete window.__smokeBusy')
  if (process.env.PHASE2_HEADLESS === '1') win.hide()
  await click('render-mp4')
  await waitFor('document.querySelector("#status").textContent.includes("MP4 ready:")', 'UI MP4 render', 90000)
  assert.ok(fs.existsSync(process.env.PHASE2_TEST_OUTPUT_PATH))
  assert.equal(await evaluate('getComputedStyle(document.querySelector("#cancel-render")).display'), 'none')
  if (process.env.PHASE2_TEST_IMPORT_PATH) {
    await click('import-audio')
    await waitFor('document.querySelector("#audio-name").textContent.includes("mono-10s-44k") && document.querySelector("#status").textContent.includes("Real Prism")', 'imported mono audio still')
    assert.match(await evaluate('document.querySelector("#audio-details").textContent'), /Mono.*44\.1 kHz/)
    await saveCanvas('preview-imported-mono.png')
  }
  const result = { status: 'PASS', initial, layers: saved.layers.length,
    draggedX, resizedW, reloadedX: saved.layers.at(-1).x,
    projectPath: process.env.PHASE2_TEST_PROJECT_PATH,
    output: process.env.PHASE2_TEST_OUTPUT_PATH }
  fs.writeFileSync(path.join(DEST, 'editor-smoke.json'), JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify({ event: 'editor-smoke', ...result }))
  app.quit()
}

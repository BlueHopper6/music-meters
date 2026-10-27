const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { app } = require('electron')
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

module.exports = async function portraitSmoke(win) {
  const dir = process.env.PHASE2_PORTRAIT_DIR
  const evaluate = expression => win.webContents.executeJavaScript(expression)
  async function wait(expression, label) {
    const deadline = Date.now() + 120000
    while (Date.now() < deadline) {
      if (await evaluate(expression)) return
      await delay(100)
    }
    throw new Error(`Timed out: ${label}; ${await evaluate('document.getElementById("status").textContent')}`)
  }
  const click = id => evaluate(`document.getElementById(${JSON.stringify(id)}).click()`)
  async function pointAt(id) {
    const point = await evaluate(`(() => { const r = document.getElementById(${JSON.stringify(id)}).getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`)
    win.webContents.sendInputEvent({ type: 'mouseMove', ...point })
    await delay(180)
    return point
  }
  async function clickControl(id) {
    const point = await pointAt(id)
    win.webContents.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 })
    win.webContents.sendInputEvent({ type: 'mouseUp', ...point, button: 'left', clickCount: 1 })
    await delay(200)
  }
  const fullscreenKey = () => {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'F11' })
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'F11' })
  }
  const change = (id, value) => evaluate(`(() => { const el = document.getElementById(${JSON.stringify(id)});
    el.value = ${JSON.stringify(String(value))}; el.dispatchEvent(new Event('change', { bubbles: true })); })()`)
  await wait('document.querySelector("#status").textContent.includes("Real Prism meter still")', 'initial still')
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".app-titlebar")).webkitAppRegion'), 'drag')
  win.showInactive()
  await delay(300)
  assert.equal(await evaluate('document.getElementById("window-fullscreen") === null'), true)
  await pointAt('window-minimize')
  assert.equal(await evaluate('getComputedStyle(document.getElementById("window-minimize")).backgroundColor'), 'rgb(44, 44, 51)')
  await pointAt('window-maximize')
  assert.equal(await evaluate('getComputedStyle(document.getElementById("window-maximize")).backgroundColor'), 'rgb(44, 44, 51)')
  await pointAt('window-close')
  assert.equal(await evaluate('getComputedStyle(document.getElementById("window-close")).backgroundColor'), 'rgb(196, 43, 28)')
  fs.writeFileSync(path.join(dir, 'close-hover.png'), (await win.capturePage()).toPNG())
  fullscreenKey()
  await wait('document.body.classList.contains("window-fullscreen")', 'app fullscreen')
  assert.equal(win.isFullScreen(), true)
  fullscreenKey()
  await wait('!document.body.classList.contains("window-fullscreen")', 'exit app fullscreen')
  await clickControl('window-maximize')
  assert.equal(win.isMaximized(), true)
  assert.equal(await evaluate('document.querySelector("#window-maximize").title'), 'Restore')
  await clickControl('window-maximize')
  assert.equal(win.isMaximized(), false)
  await clickControl('window-minimize')
  assert.equal(win.isMinimized(), true)
  win.restore(); await delay(300)
  win.setContentSize(1480, 900)

  await change('canvas-orientation', 'portrait')
  assert.deepEqual(await evaluate('({ width: document.querySelector("#stage").width, height: document.querySelector("#stage").height })'), { width: 720, height: 1280 })
  assert.ok(await evaluate('document.title.endsWith("*")'), 'orientation must participate in dirty tracking')
  // Add the other seven families through the same UI used by the owner.
  for (const type of ['spectrum', 'oscilloscope', 'spectrogram', 'waveform', 'vu', 'loudness', 'waterfall']) {
    await evaluate(`document.getElementById('add-type').value = ${JSON.stringify(type)}; document.getElementById('add-layer').click()`)
  }
  const count = await evaluate('document.querySelectorAll(".layer-item").length')
  assert.equal(count, 9)
  // Lay out all eight families and the title inside portrait bounds.
  const types = ['vectorscope', 'spectrum', 'oscilloscope', 'spectrogram', 'waveform', 'vu', 'loudness', 'waterfall']
  for (let index = 0; index < types.length; index++) {
    await evaluate(`Array.from(document.querySelectorAll('.layer-item')).find(row => row.dataset.id?.startsWith(${JSON.stringify(types[index] === 'vectorscope' ? 'scope-' : types[index] + '-')}))?.click()`)
    await change('layer-x', 0); await change('layer-y', 0)
    await change('layer-w', 300); await change('layer-h', 240)
    await change('layer-x', 40 + (index % 2) * 340)
    await change('layer-y', 140 + Math.floor(index / 2) * 270)
  }
  await evaluate(`Array.from(document.querySelectorAll('.layer-item')).find(row => row.dataset.id.startsWith('title-')).click()`)
  await change('layer-x', 40); await change('layer-y', 30)
  await change('layer-w', 640); await change('layer-h', 70); await change('text-size', 42)
  // Exercise real portrait hit testing below the former 720-pixel lower bound.
  const point = await evaluate(`(() => { const r = document.querySelector('#stage').getBoundingClientRect();
    return { x: Math.round(r.left + 530 / 720 * r.width), y: Math.round(r.top + 1070 / 1280 * r.height) }; })()`)
  win.webContents.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 })
  win.webContents.sendInputEvent({ type: 'mouseUp', ...point, button: 'left', clickCount: 1 })
  await delay(100)
  assert.equal(await evaluate('document.querySelector("#layer-y").value'), '950')
  await change('time-input', 1)
  await wait('document.querySelector("#status").textContent.includes("Real Prism meter still at 1.00 s") && document.querySelector("#preview-busy").hidden', 'portrait analysis')
  await click('save-project')
  await wait('document.querySelector("#status").textContent.includes("Saved project")', 'portrait save')
  const saved = JSON.parse(fs.readFileSync(process.env.PHASE2_TEST_PROJECT_PATH, 'utf8'))
  assert.deepEqual([saved.width, saved.height, saved.previewFrame, saved.layers.length], [720, 1280, 30, 9])
  await click('save-template')
  await evaluate('document.querySelector("#template-name").value = "Portrait smoke"')
  await click('save-template-confirm')
  await wait('document.querySelector("#save-template-modal").hidden', 'portrait template saved')
  const entry = (await evaluate('window.desktop.listTemplates()')).find(item => item.name === 'Portrait smoke')
  assert.ok(entry)
  const layout = JSON.parse(fs.readFileSync(path.join(process.env.PHASE5_TEST_USER_DATA, 'templates', `${entry.id}.json`), 'utf8')).layout
  assert.deepEqual([layout.width, layout.height, layout.audioPath, layout.previewFrame], [720, 1280, '', 0])
  await click('open-project')
  await wait('document.querySelector("#status").textContent.includes("Real Prism meter still at 1.00 s")', 'portrait reopen')
  assert.equal(await evaluate('document.querySelector("#canvas-orientation").value'), 'portrait')
  await change('export-preset', '1080p')
  assert.ok(await evaluate('document.querySelector("#stage-resolution").textContent.includes("1080 × 1920")'))
  await evaluate(`(() => { const canvas = document.querySelector('#stage');
    window.__portraitPng = canvas.toDataURL().split(',')[1]; })()`)
  fs.writeFileSync(path.join(dir, 'editor-still.png'), Buffer.from(await evaluate('window.__portraitPng'), 'base64'))
  fs.writeFileSync(path.join(dir, 'editor-1480.png'), (await win.capturePage()).toPNG())
  win.setContentSize(1000, 700); await delay(300)
  const stage = await evaluate(`(() => { const r = document.getElementById('stage').getBoundingClientRect();
    return { ratio: r.width / r.height, top: r.top, bottom: r.bottom, height: innerHeight }; })()`)
  assert.ok(Math.abs(stage.ratio - 9 / 16) < 0.001 && stage.top >= 40 && stage.bottom <= stage.height)
  fs.writeFileSync(path.join(dir, 'editor-1000.png'), (await win.capturePage()).toPNG())
  await click('render-mp4')
  await wait('document.querySelector("#status").textContent.includes("MP4 ready:")', 'portrait MP4')
  process.env.PHASE2_TEST_OUTPUT_PATH = path.join(dir, 'portrait-copy.mkv')
  await change('audio-mode', 'copy'); await click('render-mp4')
  await wait('document.querySelector("#status").textContent.includes("portrait-copy.mkv") && document.querySelector("#status").textContent.includes("MKV ready:")', 'portrait MKV')
  console.log(JSON.stringify({ event: 'portrait-smoke', status: 'PASS', meters: 8, orientation: '9:16', windowControls: 'fullscreen/maximize/minimize/restore' }))
  app.quit()
}

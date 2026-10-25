const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { app } = require('electron')
const { installedFonts } = require('../../phase2/fonts.cjs')

const dir = process.env.PHASE4_GATE_DIR
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

module.exports = async function compositionSmoke(win) {
  const evaluate = expression => win.webContents.executeJavaScript(expression)
  async function waitFor(expression, label, timeout = 300000) {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      if (await evaluate(expression)) return
      await delay(100)
    }
    throw new Error(`Timed out waiting for ${label}: ${await evaluate('document.querySelector("#status").textContent')}`)
  }
  async function still(name) {
    const encoded = await evaluate('document.getElementById("stage").toDataURL("image/png").split(",")[1]')
    fs.writeFileSync(path.join(dir, name), Buffer.from(encoded, 'base64'))
  }
  async function time(seconds) {
    await evaluate(`(() => { const input=document.getElementById('time-input'); input.value='${seconds}'; input.dispatchEvent(new Event('change',{bubbles:true})); return true })()`)
    await waitFor(`document.querySelector('#status').textContent.includes('${seconds.toFixed(2)} s') && document.querySelector('#preview-busy').hidden`, `still at ${seconds}`)
  }
  await waitFor('document.querySelector("#status").textContent.includes("Real Prism")', 'initial still')
  await evaluate('document.getElementById("open-project").click()')
  await waitFor('document.querySelectorAll(".layer-item").length === 6 && document.querySelector("#status").textContent.includes("Real Prism") && document.querySelector("#preview-busy").hidden', 'composition still')
  assert.equal(await evaluate('document.querySelector("#background-type").value'), 'gradient')
  await evaluate('document.querySelector("[data-id=gate-title]").click()')
  const availableFonts = await evaluate('Array.from(document.querySelector("#text-font").options, option => option.value)')
  assert.deepEqual(availableFonts, installedFonts(), 'the picker should match this computer\'s installed font families')
  const keyboard = await evaluate(`(() => {
    const select = document.querySelector('#text-font')
    const menu = document.querySelector('#text-font-menu')
    select.focus()
    const arrow = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
    select.dispatchEvent(arrow)
    select.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    const opened = !menu.hidden && document.activeElement?.getAttribute('role') === 'option'
    const row = menu.querySelector('.font-preview-option')
    const panel = document.querySelector('.properties-panel').getBoundingClientRect()
    const popup = menu.getBoundingClientRect()
    const rowsReadable = row.getBoundingClientRect().height >= 34 && menu.scrollHeight > menu.clientHeight
      && popup.width >= select.getBoundingClientRect().width
      && popup.top >= panel.top && popup.bottom <= panel.bottom
    const first = document.activeElement
    first?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))
    const moved = document.activeElement !== first
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    return { nativeArrow: !arrow.defaultPrevented, opened, rowsReadable, moved, closed: menu.hidden && document.activeElement === select }
  })()`)
  assert.deepEqual(keyboard, { nativeArrow: true, opened: true, rowsReadable: true, moved: true, closed: true })
  await evaluate(`document.querySelector('#text-font').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))`)
  assert.equal(await evaluate('document.querySelector("#text-font-menu").hidden'), false)
  if (!win.isVisible()) win.showInactive()
  win.webContents.invalidate()
  await delay(500)
  assert.equal(await evaluate('document.querySelector("#text-font-menu").hidden'), false)
  fs.writeFileSync(path.join(dir, 'font-picker.png'), (await win.capturePage()).toPNG())
  if (process.env.PHASE2_HEADLESS === '1') win.hide()
  await evaluate(`document.querySelector('#text-font-menu').hidden = true`)
  const chosenFont = availableFonts.includes('Arial Black') ? 'Arial Black'
    : availableFonts.find(name => !['Arial', 'Georgia', 'Verdana', 'Times New Roman', 'Courier New'].includes(name))
  assert.ok(chosenFont, 'expected a font beyond the original five')
  await evaluate(`(() => { const select=document.querySelector('#text-font'); select.value=${JSON.stringify(chosenFont)}; select.dispatchEvent(new Event('change',{bubbles:true})); return true })()`)
  assert.equal(await evaluate('document.querySelector("#text-font").value'), chosenFont)
  await time(3.5); await still('editor-105-cover.png')
  await time(5.5); await still('editor-165-cover.png')
  await time(9); await still('editor-270-cover.png')
  await evaluate('document.querySelector("[data-id=gate-art]").click()')
  await evaluate('(() => {const el=document.getElementById("image-fit"); el.value="contain"; el.dispatchEvent(new Event("change",{bubbles:true}))})()')
  await still('editor-270-contain.png')
  await evaluate('(() => {const el=document.getElementById("image-fit"); el.value="cover"; el.dispatchEvent(new Event("change",{bubbles:true}))})()')
  await still('editor-270-cover-restored.png')
  const hash = name => createHash('sha256').update(fs.readFileSync(path.join(dir, name))).digest('hex')
  assert.notEqual(hash('editor-270-cover.png'), hash('editor-270-contain.png'))
  assert.equal(hash('editor-270-cover.png'), hash('editor-270-cover-restored.png'))
  await evaluate('document.getElementById("save-project").click()')
  await waitFor('document.querySelector("#status").textContent.includes("Saved project:")', 'project save')
  assert.equal(JSON.parse(fs.readFileSync(process.env.PHASE2_TEST_PROJECT_PATH, 'utf8')).layers.find(layer => layer.id === 'gate-title').fontFamily, chosenFont)
  await evaluate('document.getElementById("open-project").click()')
  await waitFor('document.querySelector("#status").textContent.includes("Real Prism") && document.querySelector("#preview-busy").hidden', 'project reopen')
  await time(9); await still('editor-270-reopened.png')
  assert.equal(hash('editor-270-cover.png'), hash('editor-270-reopened.png'))
  await evaluate('document.getElementById("export-preset").value="720p"')
  await evaluate('document.getElementById("render-mp4").click()')
  await waitFor('document.querySelector("#status").textContent.includes("MP4 ready:")', '720p export')
  assert.ok(fs.existsSync(process.env.PHASE2_TEST_OUTPUT_PATH))
  console.log(JSON.stringify({ event: 'phase4-gate', status: 'PASS', dir }))
  app.quit()
}

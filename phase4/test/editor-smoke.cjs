const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { app } = require('electron')

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

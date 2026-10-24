const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { app } = require('electron')

module.exports = async function legacySmoke(win) {
  const evaluate = expression => win.webContents.executeJavaScript(expression)
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
  async function waitFor(expression, label) {
    const deadline = Date.now() + 300000
    while (Date.now() < deadline) {
      if (await evaluate(expression)) return
      await delay(100)
    }
    throw new Error(`Timed out waiting for ${label}: ${await evaluate('document.querySelector("#status").textContent')}`)
  }
  async function still(name) {
    const encoded = await evaluate('document.querySelector("#stage").toDataURL("image/png").split(",")[1]')
    const destination = path.join(process.env.PHASE4_GATE_DIR, name)
    fs.writeFileSync(destination, Buffer.from(encoded, 'base64'))
    return createHash('sha256').update(fs.readFileSync(destination)).digest('hex')
  }
  await waitFor('document.querySelector("#status").textContent.includes("Real Prism")', 'initial still')
  await evaluate('document.getElementById("open-project").click()')
  await waitFor('document.querySelectorAll(".layer-item").length === 8 && document.querySelector("#status").textContent.includes("Real Prism")', 'legacy project still')
  await evaluate('(() => {const input=document.getElementById("time-input"); input.value="3.5"; input.dispatchEvent(new Event("change",{bubbles:true}))})()')
  await waitFor('document.querySelector("#status").textContent.includes("3.50 s") && document.querySelector("#preview-busy").hidden', 'legacy frame')
  const before = await still('legacy-v1-before.png')
  await evaluate('document.getElementById("save-project").click()')
  await waitFor('document.querySelector("#status").textContent.includes("Saved project:")', 'legacy save')
  await evaluate('document.getElementById("open-project").click()')
  await waitFor('document.querySelector("#status").textContent.includes("Real Prism")', 'legacy reopen')
  await evaluate('(() => {const input=document.getElementById("time-input"); input.value="3.5"; input.dispatchEvent(new Event("change",{bubbles:true}))})()')
  await waitFor('document.querySelector("#status").textContent.includes("3.50 s") && document.querySelector("#preview-busy").hidden', 'legacy reopened frame')
  assert.equal(before, await still('legacy-v1-after.png'))
  const project = JSON.parse(fs.readFileSync(process.env.PHASE2_TEST_PROJECT_PATH, 'utf8'))
  assert.equal(project.version, 1)
  assert.equal(typeof project.background, 'string')
  console.log(JSON.stringify({ event: 'legacy-v1', status: 'PASS' }))
  app.quit()
}

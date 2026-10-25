const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
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
  await waitFor('document.querySelector("#status").textContent.includes("Real Prism") && document.querySelector("#preview-busy").hidden && document.getElementById("time-input").value === "1.00"', 'real preview')
  await delay(500)
  fs.writeFileSync(path.join(dir, 'editor.png'), (await win.capturePage()).toPNG())
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

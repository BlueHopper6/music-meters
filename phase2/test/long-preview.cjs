const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { app } = require('electron')

const ROOT = path.resolve(__dirname, '..', '..')
const DEST = path.join(ROOT, 'artifacts', 'phase2')
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

module.exports = async function longPreview(win) {
  const evaluate = expression => win.webContents.executeJavaScript(expression)
  async function waitFor(expression, label) {
    const deadline = Date.now() + 30000
    while (Date.now() < deadline) {
      if (await evaluate(expression)) return
      await delay(100)
    }
    throw new Error(`Timed out waiting for ${label}: ${await evaluate('document.querySelector("#status").textContent')}`)
  }
  async function selectTime(seconds, name) {
    await evaluate(`(() => { const input=document.querySelector('#time-input'); input.value=${JSON.stringify(String(seconds))}; input.dispatchEvent(new Event('change',{bubbles:true})); return true })()`)
    await waitFor(`document.querySelector('#status').textContent.includes('Real Prism') && document.querySelector('#status').textContent.includes('${Number(seconds).toFixed(2)} s')`, name)
    const image = await evaluate('document.querySelector("#stage").toDataURL("image/png").split(",")[1]')
    const target = path.join(DEST, name)
    fs.writeFileSync(target, Buffer.from(image, 'base64'))
    return createHash('sha256').update(fs.readFileSync(target)).digest('hex')
  }
  await waitFor('document.querySelector("#status").textContent.includes("Real Prism")', 'initial still')
  const thirty = await selectTime(30, 'preview-30.png')
  const ninety = await selectTime(90, 'preview-90.png')
  const oneFifty = await selectTime(150, 'preview-150.png')
  const ninetyRepeat = await selectTime(90, 'preview-90-repeat.png')
  assert.equal(ninety, ninetyRepeat)
  assert.notEqual(thirty, ninety)
  assert.notEqual(ninety, oneFifty)
  console.log(JSON.stringify({ event: 'long-preview', status: 'PASS', timestamps: [30, 90, 150],
    backwardSeekHashMatched: true }))
  app.quit()
}

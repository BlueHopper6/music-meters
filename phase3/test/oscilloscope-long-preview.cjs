const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { app } = require('electron')

const DEST = path.resolve(__dirname, '..', '..', 'artifacts', 'phase3', 'oscilloscope')
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

module.exports = async function longPreview(win) {
  const evaluate = expression => win.webContents.executeJavaScript(expression)
  async function waitFor(expression, label) {
    const deadline = Date.now() + 120000
    while (Date.now() < deadline) {
      if (await evaluate(expression)) return
      await delay(100)
    }
    throw new Error(`Timed out waiting for ${label}: ${await evaluate('document.querySelector("#status").textContent')}`)
  }
  async function still(seconds, name) {
    await evaluate(`(() => { const input = document.getElementById('time-input'); input.value = ${JSON.stringify(String(seconds))}; input.dispatchEvent(new Event('change', { bubbles: true })); return true })()`)
    await waitFor(`document.querySelector('#status').textContent.includes('${Number(seconds).toFixed(2)} s') && document.querySelector('#status').textContent.includes('Real Prism') && document.querySelector('#preview-busy').hidden`, name)
    const png = await evaluate('document.querySelector("#stage").toDataURL("image/png").split(",")[1]')
    fs.writeFileSync(path.join(DEST, name), Buffer.from(png, 'base64'))
    return createHash('sha256').update(Buffer.from(png, 'base64')).digest('hex')
  }
  fs.mkdirSync(DEST, { recursive: true })
  await waitFor('document.querySelector("#status").textContent.includes("Real Prism")', 'initial still')
  await evaluate(`(() => { document.getElementById('add-type').value = 'oscilloscope'; document.getElementById('add-layer').click(); return true })()`)
  const ninety = await still(90, 'long-90.png')
  const oneFifty = await still(150, 'long-150.png')
  const ninetyAgain = await still(90, 'long-90-repeat.png')
  assert.equal(ninety, ninetyAgain, 'Backward seek must restore the same pitch-triggered wave')
  assert.notEqual(ninety, oneFifty, 'Different audio sections should produce different stills')
  console.log(JSON.stringify({ event: 'oscilloscope-long-preview', status: 'PASS',
    timestamps: [90, 150, 90], backwardSeekHashMatched: true }))
  app.quit()
}

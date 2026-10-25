const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { app } = require('electron')

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
module.exports = async function relinkSmoke(win) {
  const evaluate = expression => win.webContents.executeJavaScript(expression)
  async function waitFor(expression, label) {
    const deadline = Date.now() + 60000
    while (Date.now() < deadline) {
      if (await evaluate(expression)) return
      await delay(100)
    }
    throw new Error(`Timed out for ${label}: ${await evaluate('document.querySelector("#status").textContent')}`)
  }
  await waitFor('document.querySelector("#template-list").options.length >= 5', 'saved templates')
  assert.equal(await evaluate('document.querySelector("#export-preset").value'), '1080p')
  assert.equal(await evaluate('document.querySelector("#template-list").selectedOptions[0].textContent'), 'My Studio Layout')
  await evaluate('document.querySelector("#open-project").click()')
  await waitFor('document.querySelectorAll(".missing-media-row").length === 2', 'two missing references')
  const names = await evaluate('Array.from(document.querySelectorAll(".missing-media-row span"), x => x.textContent)')
  assert.ok(names.some(name => name.includes('Audio')))
  assert.ok(names.some(name => name.includes('Artwork')))
  const buttonsInPanel = await evaluate(`(() => {const panel=document.querySelector('#missing-media').getBoundingClientRect();
    return Array.from(document.querySelectorAll('.missing-media-row button'), button => {
      const box=button.getBoundingClientRect(); return box.width >= 50 && box.right <= panel.right && box.left >= panel.left
    })})()`)
  assert.deepEqual(buttonsInPanel, [true, true])
  if (!win.isVisible()) win.showInactive()
  win.webContents.invalidate()
  await delay(350)
  fs.writeFileSync(path.join(process.env.PHASE5_GATE_DIR, 'missing-media.png'),
    (await win.capturePage()).toPNG())
  if (process.env.PHASE2_HEADLESS === '1') win.hide()
  await evaluate('document.querySelector(".missing-media-row button").click()')
  await waitFor('document.querySelectorAll(".missing-media-row").length === 1 && document.querySelector("#status").textContent.includes("Real Prism")', 'audio relink')
  await evaluate('document.querySelector(".missing-media-row button").click()')
  await waitFor('document.querySelector("#missing-media").hidden', 'artwork relink')
  await evaluate('document.querySelector("#save-project").click()')
  await waitFor('document.querySelector("#status").textContent.includes("Saved project")', 'relinked project save')
  const project = JSON.parse(fs.readFileSync(process.env.PHASE2_TEST_PROJECT_PATH, 'utf8'))
  assert.match(project.audioRelativePath, /song-B-880\.wav$/)
  const asset = project.layers.find(layer => layer.id === 'studio-art').imagePath
  assert.match(asset, /^song-B-project\.assets\/[a-f0-9]{64}\.png$/)
  assert.ok(fs.existsSync(path.join(process.env.PHASE5_GATE_DIR, ...asset.split('/'))))
  await evaluate('document.querySelector("#open-project").click()')
  await waitFor('document.querySelector("#status").textContent.includes("Real Prism") && document.querySelector("#preview-busy").hidden', 'relinked project reopen')
  assert.equal(await evaluate('document.querySelector("#missing-media").hidden'), true)
  console.log(JSON.stringify({ event: 'phase5-relink', status: 'PASS' }))
  app.quit()
}

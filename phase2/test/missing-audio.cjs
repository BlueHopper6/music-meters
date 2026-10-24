const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { app } = require('electron')
const { defaultProject } = require('../project.cjs')

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

module.exports = async function missingAudio(win) {
  const target = process.env.PHASE2_TEST_PROJECT_PATH
  assert.ok(target)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, JSON.stringify({ ...defaultProject(), audioPath: undefined,
    audioRelativePath: 'missing.wav' }, null, 2))
  const evaluate = expression => win.webContents.executeJavaScript(expression)
  async function waitFor(expression, label) {
    const deadline = Date.now() + 15000
    while (Date.now() < deadline) {
      if (await evaluate(expression)) return
      await delay(100)
    }
    throw new Error(`Timed out waiting for ${label}: ${await evaluate('document.querySelector("#status").textContent')}`)
  }
  await waitFor('document.querySelector("#status").textContent.includes("Ready")', 'initial editor')
  await evaluate('document.querySelector("#open-project").click()')
  await waitFor('document.querySelector("#status").textContent.includes("Audio is missing")', 'missing audio state')
  assert.match(await evaluate('document.querySelector("#audio-details").textContent'), /Audio missing/)
  await evaluate('(() => { const input=document.querySelector("#title"); input.value="Recovered layout"; input.dispatchEvent(new Event("input",{bubbles:true})); document.querySelector("#save-project").click(); return true })()')
  await waitFor('document.querySelector("#status").textContent.includes("Saved project")', 'save with missing audio')
  let stored = JSON.parse(fs.readFileSync(target, 'utf8'))
  assert.equal(stored.audioRelativePath, 'missing.wav')
  assert.equal(stored.title, 'Recovered layout')
  await evaluate('document.querySelector("#import-audio").click()')
  await waitFor('document.querySelector("#status").textContent.includes("Real Prism")', 'relinked audio still')
  await evaluate('document.querySelector("#save-project").click()')
  await waitFor('document.querySelector("#status").textContent.includes("Saved project")', 'save relinked project')
  stored = JSON.parse(fs.readFileSync(target, 'utf8'))
  assert.notEqual(stored.audioRelativePath, 'missing.wav')
  assert.ok(fs.existsSync(path.resolve(path.dirname(target), stored.audioRelativePath)))
  console.log(JSON.stringify({ event: 'missing-audio', status: 'PASS', relinked: true }))
  app.quit()
}

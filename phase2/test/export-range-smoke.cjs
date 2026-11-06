const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { app } = require('electron')
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

module.exports = async function (win) {
  const dir = process.env.MUSICMETERS_RANGE_DIR
  const evaluate = source => win.webContents.executeJavaScript(source)
  const click = id => evaluate(`document.getElementById(${JSON.stringify(id)}).click()`)
  async function wait(source, label) {
    console.log(JSON.stringify({event:'range-wait',label}))
    const deadline = Date.now() + 90000
    while (Date.now() < deadline) { if (await evaluate(source)) return; await delay(80) }
    fs.writeFileSync(path.join(dir, 'failure.png'), (await win.capturePage()).toPNG())
    throw new Error(`${label}: ${await evaluate('document.getElementById("status").textContent')}`)
  }
  async function change(id, value) {
    await evaluate(`(() => {const e=document.getElementById(${JSON.stringify(id)});e.value=${JSON.stringify(String(value))};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`)
  }
  win.showInactive()
  await wait('document.getElementById("status").textContent.includes("Real Prism")', 'initial')
  await click('import-video')
  await wait('document.getElementById("video-name").textContent.includes("colors") && document.getElementById("cancel-media").hidden && document.getElementById("status").textContent.includes("Real Prism")', 'video ready')
  await change('meter-source', 'audio')
  await click('refresh-still')
  await wait('document.getElementById("cancel-media").hidden && document.getElementById("status").textContent.includes("Real Prism")', 'routing')
  await change('time-slider', 30)
  await wait('document.getElementById("stage").dataset.previewFrame === "30"', 'playhead')
  await change('export-preset', '720p')
  await click('open-export')
  await click('export-range-enabled')
  await click('export-range-in')
  assert.equal(await evaluate('Number(document.getElementById("export-range-start").value)'), 1)
  await change('export-range-end', 0.5)
  assert.equal(await evaluate('document.getElementById("render-mp4").disabled'), true)
  await change('export-range-end', 1.5)
  await change('audio-mode', 'copy')
  assert.equal(await evaluate('document.getElementById("render-mp4").disabled'), true)
  assert.match(await evaluate('document.getElementById("export-range-note").textContent'), /accurate cuts/)
  const project = await evaluate('window.desktop.initial().then(x => x.project)')
  await assert.rejects(() => evaluate(`window.desktop.renderVideo(${JSON.stringify(project)},'720p','aac','',{start:-1,end:2})`), /export start/)
  fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify(project))
  for (const mode of ['master', 'flac', 'aac']) {
    await change('audio-mode', mode)
    const output = path.join(dir, `region-${mode}.${mode === 'aac' ? 'mp4' : 'mkv'}`)
    process.env.PHASE2_TEST_OUTPUT_PATH = output
    if (mode === 'master') {
      await delay(200)
      fs.writeFileSync(path.join(dir, 'export-region.png'), (await win.capturePage()).toPNG())
    }
    await click('render-mp4')
    await wait(`document.getElementById('status').textContent.includes(${JSON.stringify(output)}) && document.getElementById('status').textContent.includes('ready:')`, `${mode} region export`)
    assert.ok(fs.existsSync(output))
    if (mode !== 'aac') await click('open-export')
  }
  console.log(JSON.stringify({event:'export-range-pass',region:[1,1.5],exports:3,invalidRangeRejected:true,copyGuard:true,playheadBoundary:true}))
  app.quit()
}

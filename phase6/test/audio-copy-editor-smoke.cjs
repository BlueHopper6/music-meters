const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { app, dialog } = require('electron')

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

module.exports = async function audioCopyEditorSmoke(win) {
  const dir = process.env.PHASE6_AUDIO_COPY_EDITOR_DIR
  const evaluate = source => win.webContents.executeJavaScript(source)
  async function waitFor(source, label) {
    const deadline = Date.now() + 120000
    while (Date.now() < deadline) {
      if (await evaluate(source)) return
      await delay(100)
    }
    throw new Error(`Timed out waiting for ${label}: ${await evaluate('document.getElementById("status").textContent')}`)
  }
  await waitFor('document.getElementById("status").textContent.includes("Real Prism")', 'initial still')
  assert.equal(await evaluate('document.getElementById("audio-mode").value'), 'aac')
  await evaluate(`(() => { const mode = document.getElementById('audio-mode');
    mode.value = 'copy'; mode.dispatchEvent(new Event('change', { bubbles: true })); return true })()`)
  assert.equal(await evaluate('document.getElementById("render-mp4").textContent'), 'Render MKV')
  win.setSize(1000, 700)
  await delay(150)
  const toolbar = await evaluate(`(() => ({
    brandRight: document.querySelector('.brand').getBoundingClientRect().right,
    actionsLeft: document.querySelector('.toolbar-actions').getBoundingClientRect().left,
    licenseRight: document.querySelector('.license-disclosure').getBoundingClientRect().right,
    viewport: innerWidth,
  }))()`)
  assert.ok(toolbar.brandRight < toolbar.actionsLeft && toolbar.licenseRight <= toolbar.viewport,
    `Export controls overflow the minimum window: ${JSON.stringify(toolbar)}`)
  await evaluate('document.getElementById("export-preset").value = "720p"')
  const first = path.join(dir, 'Editor copy one.mkv')
  let saveOptions
  const originalDialog = dialog.showSaveDialog
  delete process.env.PHASE2_TEST_OUTPUT_PATH
  dialog.showSaveDialog = async (_win, options) => {
    saveOptions = options
    return { canceled: false, filePath: path.join(dir, 'Editor copy one') }
  }
  await evaluate('document.getElementById("render-mp4").click()')
  await waitFor('document.getElementById("status").textContent.includes("MKV ready:")', 'first MKV')
  dialog.showSaveDialog = originalDialog
  assert.equal(saveOptions.title, 'Render MKV video')
  assert.equal(saveOptions.filters[0].extensions[0], 'mkv')
  assert.ok(saveOptions.defaultPath.endsWith('.mkv'))
  assert.ok(fs.existsSync(first))
  const second = path.join(dir, 'Editor copy two.mkv')
  process.env.PHASE2_TEST_OUTPUT_PATH = second
  await evaluate('document.getElementById("render-mp4").click()')
  await waitFor(`document.getElementById('status').textContent.includes(${JSON.stringify(second)}) &&
    document.getElementById('status').textContent.includes('MKV ready:')`, 'second MKV')
  assert.ok(fs.existsSync(second))
  console.log(JSON.stringify({ event: 'audio-copy-editor-pass', first, second, toolbar }))
  app.quit()
}

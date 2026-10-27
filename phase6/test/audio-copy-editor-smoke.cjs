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
  win.showInactive()
  assert.equal(await evaluate('document.getElementById("audio-mode").value'), 'aac')
  assert.equal(await evaluate('document.querySelector("#audio-mode option[value=\\"aac\\"]").textContent'), 'MP4 · AAC up to 320 kb/s')
  assert.equal(await evaluate('document.querySelector("#audio-mode option[value=\\"copy\\"]").textContent'), 'MKV · Source audio copy (no re-encode)')
  assert.equal(await evaluate('document.getElementById("stage-resolution").textContent'), 'Layout 1280 × 720 · Export 1920 × 1080 · 16:9')
  await evaluate(`(() => { const mode = document.getElementById('audio-mode');
    mode.value = 'copy'; mode.dispatchEvent(new Event('change', { bubbles: true })); return true })()`)
  assert.equal(await evaluate('document.getElementById("render-mp4").textContent'), 'Export MKV')
  win.setSize(1000, 700)
  await delay(150)
  const toolbar = await evaluate(`(() => ({
    menusLeft: document.querySelector('.command-menus').getBoundingClientRect().left,
    menusRight: document.querySelector('.command-menus').getBoundingClientRect().right,
    actionsLeft: document.querySelector('.toolbar-primary-actions').getBoundingClientRect().left,
    actionsRight: document.querySelector('.toolbar-primary-actions').getBoundingClientRect().right,
    viewport: innerWidth, height: document.querySelector('.toolbar').getBoundingClientRect().height,
    controlsLeft: document.querySelector('.window-controls').getBoundingClientRect().left,
  }))()`)
  assert.ok(toolbar.menusLeft >= 0 && toolbar.menusRight < toolbar.actionsLeft && toolbar.actionsRight <= toolbar.controlsLeft && toolbar.height === 40)
  await evaluate('document.getElementById("open-export").click()')
  const dialogBounds = await evaluate(`(() => { const r = document.querySelector('.export-card').getBoundingClientRect();
    return { left: r.left, right: r.right, bottom: r.bottom, viewport: innerWidth, height: innerHeight }; })()`)
  assert.ok(dialogBounds.left >= 0 && dialogBounds.right <= dialogBounds.viewport && dialogBounds.bottom <= dialogBounds.height)
  win.webContents.invalidate(); await delay(350)
  fs.writeFileSync(path.join(dir, 'export-dialog.png'), (await win.capturePage()).toPNG())
  await evaluate('document.getElementById("export-cancel").click()')
  const heading = await evaluate(`(() => ({
    panelRight: document.querySelector('.center-panel').getBoundingClientRect().right,
    resolutionRight: document.getElementById('stage-resolution').getBoundingClientRect().right,
    fullscreenRight: document.getElementById('fullscreen-preview').getBoundingClientRect().right,
    headingBottom: document.querySelector('.canvas-heading').getBoundingClientRect().bottom,
    stageTop: document.getElementById('stage').getBoundingClientRect().top,
  }))()`)
  assert.ok(heading.resolutionRight <= heading.panelRight
    && heading.fullscreenRight <= heading.panelRight
    && heading.headingBottom <= heading.stageTop,
  `Layout and export size label overlaps the stage at the minimum window: ${JSON.stringify(heading)}`)
  await evaluate(`(() => { const preset = document.getElementById('export-preset');
    preset.value = '720p'; preset.dispatchEvent(new Event('change', { bubbles: true })); return true })()`)
  assert.equal(await evaluate('document.getElementById("stage-resolution").textContent'), 'Layout 1280 × 720 · Export 1280 × 720 · 16:9')
  assert.deepEqual(await evaluate('({ width: document.getElementById("stage").width, height: document.getElementById("stage").height })'), { width: 1280, height: 720 })
  const first = path.join(dir, 'Editor copy one.mkv')
  let saveOptions
  const originalDialog = dialog.showSaveDialog
  delete process.env.PHASE2_TEST_OUTPUT_PATH
  dialog.showSaveDialog = async (_win, options) => {
    saveOptions = options
    return { canceled: false, filePath: path.join(dir, 'Editor copy one') }
  }
  await evaluate('document.getElementById("open-export").click(); document.getElementById("render-mp4").click()')
  await waitFor('document.getElementById("status").textContent.includes("MKV ready:")', 'first MKV')
  dialog.showSaveDialog = originalDialog
  assert.equal(saveOptions.title, 'Render MKV video')
  assert.equal(saveOptions.filters[0].extensions[0], 'mkv')
  assert.ok(saveOptions.defaultPath.endsWith('.mkv'))
  assert.ok(fs.existsSync(first))
  const second = path.join(dir, 'Editor copy two.mkv')
  process.env.PHASE2_TEST_OUTPUT_PATH = second
  await evaluate('document.getElementById("open-export").click(); document.getElementById("render-mp4").click()')
  await waitFor(`document.getElementById('status').textContent.includes(${JSON.stringify(second)}) &&
    document.getElementById('status').textContent.includes('MKV ready:')`, 'second MKV')
  assert.ok(fs.existsSync(second))
  console.log(JSON.stringify({ event: 'audio-copy-editor-pass', first, second, toolbar }))
  app.quit()
}

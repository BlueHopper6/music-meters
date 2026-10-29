const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { app } = require('electron')

module.exports = async function historySmoke(win) {
  const evaluate = source => win.webContents.executeJavaScript(source)
  const click = id => evaluate(`document.getElementById(${JSON.stringify(id)}).click()`)
  async function wait(source, label) {
    const deadline = Date.now() + 30000
    while (Date.now() < deadline) {
      if (await evaluate(source)) return
      await new Promise(resolve => setTimeout(resolve, 60))
    }
    const detail = await evaluate(`({ status: document.getElementById('status').textContent,
      playback: document.getElementById('playback-status').textContent,
      paused: document.getElementById('playback-audio').paused,
      time: document.getElementById('playback-audio').currentTime })`)
    throw new Error(`Timed out: ${label}: ${JSON.stringify(detail)}`)
  }
  const ready = () => wait('!document.getElementById("editor-screen").inert && document.getElementById("preview-busy").hidden', 'editor operation complete')
  const state = () => evaluate('window.desktop.initial()')
  async function title(value) {
    await evaluate(`(() => { const el = document.getElementById('title'); el.focus(); el.value = ${JSON.stringify(value)};
      el.dispatchEvent(new Event('input', { bubbles: true })); })()`)
  }
  async function undo() { await click('undo-project'); await ready() }
  async function redo() { await click('redo-project'); await ready() }
  async function shortcut(keyCode, shift = false) {
    await evaluate('document.getElementById("stage").focus()')
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers: shift ? ['control', 'shift'] : ['control'] })
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers: shift ? ['control', 'shift'] : ['control'] })
    await new Promise(resolve => setTimeout(resolve, 100))
    await ready()
  }
  async function useLayout(id) {
    const wasPlaying = await evaluate('!document.getElementById("playback-audio").paused')
    await click('manage-templates')
    await wait('!document.getElementById("template-manager-modal").hidden', 'template manager')
    assert.equal(await evaluate('document.querySelectorAll(".template-manager-row.selected").length'), 0, 'Remembered dropdown selection must not highlight an unused template')
    const position = await evaluate('Number(document.getElementById("time-slider").value)')
    if (wasPlaying) {
      assert.equal(await evaluate('document.getElementById("playback-audio").paused'), true)
      const clock = await evaluate('Math.floor(document.getElementById("playback-audio").currentTime * 30)')
      assert.ok(Math.abs(position - clock) <= 1, 'Opening manager preserves the live audio clock')
    }
    await evaluate(`Array.from(document.querySelectorAll('.template-manager-row')).find(row => row.dataset.templateId === ${JSON.stringify(id)}).querySelector('[data-action=use]').click()`)
    await ready()
    assert.equal(Number(await evaluate('document.getElementById("time-slider").value')), position, 'Changing templates must preserve the latest live playhead')
  }
  await wait('document.getElementById("splash-screen").hidden && !document.getElementById("project-manager-screen").hidden', 'startup')
  await click('pm-new-blank'); await ready()
  await click('import-audio'); await ready()
  const audio = (await state()).project.audioPath
  assert.equal(audio, process.env.PHASE2_TEST_IMPORT_PATH)
  // Undo/redo the import must synchronize audio, metadata and preview controls.
  await undo()
  assert.equal((await state()).project.audioPath, '')
  assert.equal((await state()).metadata, null)
  await redo()
  assert.equal((await state()).project.audioPath, audio)
  assert.ok((await state()).metadata)
  await click('save-project')
  await wait('document.getElementById("status").textContent.startsWith("Saved project:")', 'save baseline')
  const saved = await state(), baselineTitle = saved.project.title
  await title('A'); await title('Audio'); await title('Audio project')
  await evaluate('document.getElementById("stage").focus()')
  await shortcut('Z')
  assert.equal(await evaluate('document.getElementById("title").value'), baselineTitle)
  assert.equal(await evaluate('document.title.endsWith("*")'), false)
  await shortcut('Z', true)
  assert.equal(await evaluate('document.getElementById("title").value'), 'Audio project')
  assert.equal(await evaluate('document.title.endsWith("*")'), true)
  await undo(); await title('Different edit')
  assert.equal(await evaluate('document.getElementById("redo-project").disabled'), true)
  await evaluate('document.getElementById("stage").focus()')
  // The actual manager Use layout action must keep the song AND project path.
  await evaluate(`(() => { const el = document.getElementById('time-slider'); el.value = '30'; el.dispatchEvent(new Event('input', { bubbles: true })); })()`)
  await wait('document.getElementById("playback-cancel").hidden', 'seek complete')
  await useLayout('starter:Social')
  let current = await state()
  assert.equal(current.project.audioPath, audio)
  assert.equal(current.projectPath, saved.projectPath)
  assert.deepEqual(current.metadata, saved.metadata)
  assert.equal(current.project.width, 720)
  assert.equal(current.project.title, 'Different edit')
  assert.equal(await evaluate('document.getElementById("time-slider").value'), '30')
  await evaluate(`(() => { const el = document.getElementById('time-slider'); el.value = '45'; el.dispatchEvent(new Event('input', { bubbles: true })); })()`)
  await wait('document.getElementById("playback-cancel").hidden', 'seek after layout edit')
  await undo()
  assert.equal((await state()).project.layers.length, 0)
  assert.equal((await state()).project.audioPath, audio)
  assert.equal(await evaluate('document.getElementById("time-slider").value'), '45', 'Undo must retain the current playhead, not the edit snapshot marker')
  await evaluate(`(() => { const el = document.getElementById('time-slider'); el.value = '60'; el.dispatchEvent(new Event('input', { bubbles: true })); })()`)
  await wait('document.getElementById("playback-cancel").hidden', 'seek before redo')
  await shortcut('Y')
  assert.equal((await state()).project.width, 720)
  assert.equal(await evaluate('document.getElementById("time-slider").value'), '60', 'Redo must retain a subsequent seek position')
  assert.equal(await evaluate('document.title.endsWith("*")'), true)
  await useLayout('starter:Afterglow')
  assert.equal((await state()).project.width, 1280)
  assert.equal((await state()).project.audioPath, audio)
  await evaluate(`(() => { const el = document.getElementById('time-slider'); el.value = '9'; el.dispatchEvent(new Event('input', { bubbles: true })); })()`)
  await wait('document.getElementById("playback-cancel").hidden', 'seek before live template change')
  await click('playback-play')
  await wait('!document.getElementById("playback-audio").paused && document.getElementById("playback-audio").currentTime > 0.6', 'live playhead advances beyond saved marker')
  await useLayout('starter:Social')
  await useLayout('starter:Afterglow')
  const custom = await evaluate(`window.desktop.saveTemplate('History test', ${(JSON.stringify((await state()).project))})`)
  await useLayout(custom.id)
  assert.equal((await state()).project.audioPath, audio)
  assert.equal((await state()).projectPath, saved.projectPath)
  await evaluate(`(() => { const el = document.getElementById('background-type'); el.value = 'image'; el.dispatchEvent(new Event('change', { bubbles: true })); })()`)
  await click('background-choose-image')
  await wait('document.getElementById("background-image-name").textContent === "artwork.png"', 'artwork chosen')
  await ready()
  await undo()
  assert.equal((await state()).project.background.imagePath, '')
  await redo()
  assert.equal((await state()).project.background.imagePath, process.env.PHASE4_TEST_IMAGE_PATH)
  // Undo/redo structural and inspector edits, including a grouped stage drag.
  const beforeCount = await evaluate('document.querySelectorAll(".layer-item").length')
  await evaluate('document.getElementById("add-type").value = "text"; document.getElementById("add-layer").click()')
  assert.equal(await evaluate('document.querySelectorAll(".layer-item").length'), beforeCount + 1)
  await undo()
  assert.equal(await evaluate('document.querySelectorAll(".layer-item").length'), beforeCount)
  await redo()
  assert.equal(await evaluate('document.querySelectorAll(".layer-item").length'), beforeCount + 1)
  await evaluate('document.querySelector("#layers .layer-item").click()')
  const startX = Number(await evaluate('document.getElementById("layer-x").value'))
  await evaluate(`(() => { const el = document.getElementById('layer-x'); el.value = ${startX + 8}; el.dispatchEvent(new Event('change', { bubbles: true })); })()`)
  await undo()
  assert.equal(Number(await evaluate('document.getElementById("layer-x").value')), startX)
  await redo()
  assert.equal(Number(await evaluate('document.getElementById("layer-x").value')), startX + 8)
  win.showInactive()
  const point = await evaluate(`(() => { const r = document.getElementById('selection').getBoundingClientRect();
    return { x: Math.round(r.x + 15), y: Math.round(r.y + 15) }; })()`)
  win.webContents.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 })
  for (const distance of [10, 20, 30]) win.webContents.sendInputEvent({ type: 'mouseMove', x: point.x + distance, y: point.y, button: 'left' })
  win.webContents.sendInputEvent({ type: 'mouseUp', x: point.x + 30, y: point.y, button: 'left', clickCount: 1 })
  await new Promise(resolve => setTimeout(resolve, 100))
  const draggedX = Number(await evaluate('document.getElementById("layer-x").value'))
  assert.ok(draggedX > startX + 8, 'Pointer drag must move the selected layer')
  await undo()
  assert.equal(Number(await evaluate('document.getElementById("layer-x").value')), startX + 8, 'One undo reverses the whole drag')
  await redo()
  assert.equal(Number(await evaluate('document.getElementById("layer-x").value')), draggedX)
  await click('playback-muted'); await click('playback-play')
  await wait('!document.getElementById("playback-audio").paused && document.getElementById("playback-audio").currentTime > 0.1', 'audio plays after switching templates')
  // Observe the actual pending-still UI and immediately start live playback.
  await evaluate(`(() => {
    window.undoStillStates = [];
    const busy = document.getElementById('preview-busy');
    const observer = new MutationObserver(() => {
      if (busy.hidden) return;
      window.undoStillStates.push({ inert: document.getElementById('editor-screen').inert,
        playDisabled: document.getElementById('playback-play').disabled,
        paused: document.getElementById('playback-audio').paused, message: busy.textContent });
      observer.disconnect(); document.getElementById('playback-play').click();
    });
    observer.observe(busy, { attributes: true, attributeFilter: ['hidden'] });
  })()`)
  await click('undo-project')
  await wait('window.undoStillStates.length === 1', 'undo starts a nonblocking still update')
  const pending = await evaluate('window.undoStillStates[0]')
  assert.equal(pending.inert, false, 'Still analysis must not lock the editor')
  assert.equal(pending.playDisabled, false, 'Play is available while the still updates')
  assert.equal(pending.paused, true, 'Undo stops stale playback before starting a new session')
  assert.equal(pending.message, 'Updating still…')
  await wait('!document.getElementById("playback-audio").paused && document.getElementById("preview-busy").hidden', 'Play cancels the still and starts live preview')
  assert.ok(!(await evaluate('document.getElementById("status").textContent')).startsWith('Updating still'))
  await click('playback-play')
  const oldImport = process.env.PHASE2_TEST_IMPORT_PATH
  process.env.PHASE2_TEST_IMPORT_PATH = process.env.PHASE2_HISTORY_AUDIO_B
  await click('import-audio'); await ready()
  assert.equal((await state()).project.audioPath, process.env.PHASE2_HISTORY_AUDIO_B)
  // Temporarily unavailable files remain relinkable rather than restoring stale metadata.
  assert.equal(path.resolve(audio), path.join(path.resolve(process.env.PHASE2_STARTUP_SMOKE_DIR), 'song-A.wav'))
  assert.equal(fs.lstatSync(audio).isSymbolicLink(), false)
  assert.equal(fs.lstatSync(path.dirname(audio)).isSymbolicLink(), false)
  assert.equal(fs.existsSync(audio + '.held'), false)
  fs.renameSync(audio, audio + '.held')
  try {
    await undo()
    assert.equal((await state()).metadata, null)
    assert.ok((await state()).missingMedia.some(item => item.kind === 'audio'))
  } finally { fs.renameSync(audio + '.held', audio) }
  await redo()
  await undo()
  assert.ok((await state()).metadata)
  await redo()
  await undo()
  assert.equal((await state()).project.audioPath, audio)
  await redo()
  assert.equal((await state()).project.audioPath, process.env.PHASE2_HISTORY_AUDIO_B)
  process.env.PHASE2_TEST_IMPORT_PATH = oldImport
  // Renderer cannot forge a new audio/artwork path through the restore API.
  current = await state()
  const rejected = project => evaluate(`window.desktop.restoreProject(${JSON.stringify(project)}).then(() => false, () => true)`)
  assert.equal(await rejected({ ...current.project, audioPath: path.join(path.dirname(audio), 'not-chosen.wav') }), true)
  const withImage = structuredClone(current.project)
  withImage.layers.push({ ...require('../project.cjs').imageLayer('forged'), imagePath: path.join(path.dirname(audio), 'not-chosen.png') })
  assert.equal(await rejected(withImage), true)
  process.env.PHASE2_TEST_OUTPUT_PATH = path.join(process.env.PHASE2_STARTUP_SMOKE_DIR, 'history-export.mp4')
  await click('open-export')
  await evaluate('document.getElementById("export-preset").value = "720p"')
  await click('render-mp4')
  await wait('!document.getElementById("export-running-label").hidden', 'export started')
  assert.equal(await evaluate('document.getElementById("undo-project").disabled'), true)
  assert.equal(await rejected(current.project), true, 'Restore must be rejected during export')
  await wait('document.getElementById("status").textContent.includes("MP4 ready:")', 'export finished')
  assert.equal(await evaluate('document.getElementById("undo-project").disabled'), false, 'Undo re-enabled after export')
  // Capture actual packaged UI at minimum supported size.
  win.setContentSize(1000, 700)
  await click('toolbar-edit')
  const clipped = await evaluate(`Array.from(document.querySelectorAll('.menu-trigger, .toolbar-primary-actions button'))
    .filter(el => el.getClientRects().length).some(el => el.getBoundingClientRect().right > innerWidth)`)
  assert.equal(clipped, false)
  fs.writeFileSync(path.join(process.env.PHASE2_STARTUP_SMOKE_DIR, 'edit-menu.png'), (await win.webContents.capturePage()).toPNG())
  await click('toolbar-edit')
  // New/open/closed project boundaries clear history and prior audio authority.
  await click('close-project')
  await click('unsaved-changes-discard')
  await wait('!document.getElementById("project-manager-screen").hidden', 'closed project')
  await click('pm-new-blank'); await ready()
  assert.equal(await evaluate('document.getElementById("undo-project").disabled'), true)
  assert.equal(await evaluate('document.getElementById("redo-project").disabled'), true)
  assert.equal(await rejected(current.project), true)
  process.env.PHASE2_TEST_PROJECT_PATH = saved.projectPath
  await click('open-project'); await ready()
  await wait('document.getElementById("audio-name").textContent === "song-A.wav"', 'saved project reopened')
  assert.equal(await evaluate('document.getElementById("undo-project").disabled'), true)
  assert.equal(await evaluate('document.getElementById("redo-project").disabled'), true)
  assert.equal((await state()).projectPath, saved.projectPath)
  await click('close-project')
  await wait('!document.getElementById("project-manager-screen").hidden', 'project manager')
  await click('pm-new-template')
  await click('template-picker-create'); await ready()
  assert.equal((await state()).project.audioPath, '')
  assert.equal((await state()).metadata, null)
  console.log(JSON.stringify({ event: 'history-smoke', status: 'PASS', tests: 'template audio/project identity, import undo/redo, grouped typing, dirty state, branching, structural edits, trusted media, session reset' }))
  app.quit()
}

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { dialog, shell } = require('electron')
const { readLibraryProject } = require('../project-library.cjs')

module.exports = async function projectManagerSmoke(win, source) {
  const output = process.env.PHASE2_STARTUP_SMOKE_DIR
  const evaluate = expression => win.webContents.executeJavaScript(expression)
  const click = id => evaluate(`document.getElementById(${JSON.stringify(id)}).click()`)
  const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
  const originalAudio = readLibraryProject(source).project.audioPath
  const originalHash = hash(originalAudio)
  async function wait(expression, label) {
    const deadline = Date.now() + 15000
    while (Date.now() < deadline) { if (await evaluate(expression)) return; await new Promise(resolve => setTimeout(resolve, 50)) }
    throw new Error(`${label}: ${await evaluate('document.getElementById("project-action-status").textContent')}`)
  }
  async function action(projectPath, name) {
    await evaluate(`Array.from(document.querySelectorAll('.project-card')).find(card => card.dataset.projectPath === ${JSON.stringify(projectPath)}).querySelector('[data-project-options]').click()`)
    await evaluate(`Array.from(document.querySelectorAll('.project-card')).find(card => card.dataset.projectPath === ${JSON.stringify(projectPath)}).querySelector('[data-project-action=${name}]').click()`)
    await wait('!document.getElementById("project-action-modal").hidden', 'project action modal')
    assert.equal(await evaluate('document.getElementById("editor-screen").hidden'), true, 'Action button must not also open the project')
  }
  const recent = () => evaluate('window.desktop.getRecentProjects()')
  await action(source, 'rename')
  assert.equal(await evaluate('document.activeElement.id'), 'project-action-name')
  win.focus(); win.webContents.focus()
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab', modifiers: ['shift'] })
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab', modifiers: ['shift'] })
  await wait('document.activeElement.id === "project-action-confirm"', 'modal reverse Tab trap')
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' })
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' })
  await wait('document.activeElement.id === "project-action-name"', 'modal forward Tab trap')
  await evaluate(`document.getElementById('project-action-name').value = 'Renamed in manager'`)
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' })
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' })
  await wait('document.getElementById("project-action-modal").hidden', 'rename complete')
  const previousSource = source
  source = (await recent()).find(item => item.name === 'Renamed in manager').path
  assert.equal(fs.existsSync(previousSource), false)
  assert.equal(path.basename(source), 'Renamed in manager.json')
  assert.equal(path.basename(path.dirname(source)), 'Renamed in manager')
  assert.equal(readLibraryProject(source).project.title, 'Renamed in manager')
  assert.equal((await recent()).find(item => item.path === source).name, 'Renamed in manager')
  assert.equal(await evaluate('document.activeElement.dataset.projectOptions'), 'true')
  assert.equal(hash(originalAudio), originalHash)
  await action(source, 'rename')
  await evaluate(`document.getElementById('project-action-name').value = ' '`)
  await click('project-action-confirm')
  assert.equal(readLibraryProject(source).project.title, 'Renamed in manager')
  assert.ok(await evaluate('document.getElementById("project-action-status").textContent.includes("1–200")'))
  await click('project-action-cancel')

  const originalDialog = dialog.showSaveDialog, originalMessage = dialog.showMessageBox, originalTrash = shell.trashItem
  try {
    let releaseChoice
    dialog.showSaveDialog = () => new Promise(resolve => { releaseChoice = resolve })
    await action(source, 'copy'); await click('project-action-confirm')
    const choiceDeadline = Date.now() + 5000
    while (!releaseChoice && Date.now() < choiceDeadline) await new Promise(resolve => setTimeout(resolve, 25))
    assert.ok(releaseChoice)
    assert.equal(await evaluate('window.desktop.newBlankProject().then(() => false, () => true)'), true, 'Project opens are blocked while an operation is pending')
    assert.equal(await evaluate(`window.desktop.manageProject(${JSON.stringify(source)}, 'rename', 'Concurrent edit').then(() => false, () => true)`), true, 'Concurrent project changes are rejected')
    releaseChoice({ canceled: true, filePath: undefined })
    await wait('document.getElementById("project-action-status").textContent === "No changes made."', 'cancelled destination')
    await click('project-action-cancel')
    const sourceHash = hash(source)
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: source })
    await action(source, 'copy'); await click('project-action-confirm')
    await wait('document.getElementById("project-action-status").textContent === "There’s already a project in that folder with that same name. Choose a different name or location."', 'collision rejection')
    assert.equal(hash(source), sourceHash)
    await click('project-action-cancel')
    const copyFile = path.join(output, 'Library copy.json')
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: copyFile })
    await action(source, 'copy'); await click('project-action-confirm')
    await wait('document.getElementById("project-action-modal").hidden', 'copy complete')
    const copied = (await recent()).find(item => item.name === 'Library copy')
    assert.ok(copied)
    assert.equal(hash(source), sourceHash)
    const copiedProject = readLibraryProject(copied.path)
    assert.equal(hash(copiedProject.project.audioPath), originalHash)
    assert.equal(copiedProject.project.audioPath, originalAudio)
    assert.equal(fs.existsSync(path.join(path.dirname(copied.path), 'audio')), false)
    assert.equal(fs.existsSync(path.join(path.dirname(copied.path), '.musicmeters-owned-media')), false)
    assert.ok(fs.existsSync(copiedProject.project.background.imagePath))
    const note = path.join(path.dirname(copied.path), 'keep-this-note.txt')
    fs.writeFileSync(note, 'Unrelated content must stay')
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path.join(output, 'Moved library project.json') })
    await action(copied.path, 'move'); await click('project-action-confirm')
    await wait('document.getElementById("project-action-modal").hidden', 'move complete')
    const moved = (await recent()).find(item => item.path.endsWith('Moved library project.json'))
    assert.ok(moved)
    assert.equal(fs.existsSync(copied.path), false)
    assert.equal((await recent()).some(item => item.path === copied.path), false)
    assert.equal(fs.readFileSync(note, 'utf8'), 'Unrelated content must stay')
    assert.ok(fs.existsSync(copiedProject.project.audioPath), 'Original audio locations are retained')
    assert.equal(hash(readLibraryProject(moved.path).project.audioPath), originalHash)
    const forbidden = await evaluate(`window.desktop.manageProject(${JSON.stringify(path.join(output, 'not-recent.json'))}, 'rename', 'Forbidden').then(() => false, () => true)`)
    assert.equal(forbidden, true)
    win.setContentSize(1000, 700)
    win.focus(); win.webContents.focus()
    await wait('document.hasFocus()', 'focus for project menu')
    fs.writeFileSync(path.join(output, 'project-manager-actions.png'), (await win.webContents.capturePage()).toPNG())
    await evaluate(`Array.from(document.querySelectorAll('.project-card')).find(card => card.dataset.projectPath === ${JSON.stringify(moved.path)}).querySelector('[data-project-options]').click()`)
    await wait(`Boolean(document.querySelector('.project-options-trigger[aria-expanded=true]'))`, 'project menu visible')
    await evaluate(`document.querySelector('.project-options-trigger[aria-expanded=true]').parentElement.querySelector('[role=separator]').click()`)
    assert.equal(await evaluate('document.getElementById("editor-screen").hidden'), true, 'Menu whitespace must not open a project')
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Down' })
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Down' })
    await wait(`document.activeElement.dataset.projectAction === 'move'`, 'project menu arrow navigation')
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    fs.writeFileSync(path.join(output, 'project-manager-options.png'), (await win.webContents.capturePage()).toPNG())
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
    await wait(`document.activeElement.dataset.projectOptions === 'true' && !document.querySelector('.project-options-trigger[aria-expanded=true]')`, 'project menu Escape restores focus')
    await action(moved.path, 'move')
    fs.writeFileSync(path.join(output, 'project-manager-move-dialog.png'), (await win.webContents.capturePage()).toPNG())
    await click('project-action-cancel')
    await evaluate(`Array.from(document.querySelectorAll('.project-card')).find(card => card.dataset.projectPath === ${JSON.stringify(moved.path)}).click()`)
    await wait('!document.getElementById("editor-screen").hidden && document.getElementById("status").textContent.includes("Real Prism")', 'open moved project with linked audio and copied artwork')
    const loaded = await evaluate('window.desktop.initial()')
    assert.equal(loaded.projectPath, moved.path)
    assert.equal(loaded.missingMedia.length, 0)
    assert.equal(await evaluate(`window.desktop.manageProject(${JSON.stringify(moved.path)}, 'rename', 'Blocked while open').then(() => false, () => true)`), true)
    await click('close-project')
    await wait('!document.getElementById("project-manager-screen").hidden', 'close moved project')
    const movedAudio = readLibraryProject(moved.path).project.audioPath
    async function deleteAction() {
      await evaluate(`Array.from(document.querySelectorAll('.project-card')).find(card => card.dataset.projectPath === ${JSON.stringify(moved.path)}).querySelector('[data-project-options]').click()`)
      await evaluate(`Array.from(document.querySelectorAll('.project-card')).find(card => card.dataset.projectPath === ${JSON.stringify(moved.path)}).querySelector('[data-project-action=delete]').click()`)
      await wait('!document.getElementById("project-manager-screen").inert', 'delete complete')
    }
    let confirmations = 0, recycled = 0
    dialog.showMessageBox = async (_window, options) => {
      assert.equal(options.defaultId, 0); assert.equal(options.cancelId, 0)
      assert.ok(options.detail.includes('Original media and unrelated files will be kept'))
      confirmations++; return { response: 0 }
    }
    shell.trashItem = async () => { assert.fail('Cancelled delete must not recycle') }
    await deleteAction()
    assert.equal(confirmations, 1); assert.ok(fs.existsSync(moved.path)); assert.ok(fs.existsSync(movedAudio))
    const keep = path.join(path.dirname(moved.path), 'keep.txt'); fs.writeFileSync(keep, 'Unrelated file')
    dialog.showMessageBox = async () => ({ response: 1 })
    shell.trashItem = async staging => { recycled++; fs.renameSync(staging, path.join(output, 'fake-recycle-bin')) }
    await deleteAction()
    assert.equal(recycled, 1); assert.equal(fs.existsSync(moved.path), false); assert.equal(fs.existsSync(movedAudio), true)
    assert.equal((await recent()).some(item => item.path === moved.path), false)
    assert.equal(fs.readFileSync(keep, 'utf8'), 'Unrelated file')
    assert.equal(hash(originalAudio), originalHash); assert.ok(fs.existsSync(source))
    const unavailable = source + '.temporarily-moved'
    const sourceCard = () => `Array.from(document.querySelectorAll('.project-card')).some(card => card.dataset.projectPath === ${JSON.stringify(source)})`
    // A source deleted after opening an action must not open a destination dialog.
    await action(source, 'copy')
    fs.renameSync(source, unavailable)
    try {
      dialog.showSaveDialog = async () => { assert.fail('Missing source must not prompt for a destination') }
      await click('project-action-confirm')
      await wait('document.getElementById("project-action-modal").hidden', 'missing source closes action')
      assert.equal(await evaluate(sourceCard()), false)
      assert.equal(await evaluate('document.getElementById("project-manager-status").textContent'), 'This project can’t be found. It may have been moved or deleted. Use Open project to find it again.')
    } finally { fs.renameSync(unavailable, source) }
    await evaluate(`window.dispatchEvent(new Event('focus'))`)
    await wait(sourceCard(), 'restored project appears on focus')
    // A stale card click refreshes the list and shows a friendly missing-project message.
    fs.renameSync(source, unavailable)
    try {
      await evaluate(`Array.from(document.querySelectorAll('.project-card')).find(card => card.dataset.projectPath === ${JSON.stringify(source)}).click()`)
      await wait(`!(${sourceCard()})`, 'missing open removes stale card')
      assert.equal(await evaluate('document.getElementById("editor-screen").hidden'), true)
      assert.ok(await evaluate('document.getElementById("project-manager-status").textContent.startsWith("This project can’t be found.")'))
    } finally { fs.renameSync(unavailable, source) }
    await evaluate(`window.dispatchEvent(new Event('focus'))`)
    await wait(sourceCard(), 'restored project listed again')
    // Also cover a source disappearing while the native destination dialog is open.
    dialog.showSaveDialog = async () => { fs.renameSync(source, unavailable); return { canceled: false, filePath: path.join(output, 'Missing source copy.json') } }
    try {
      await action(source, 'copy'); await click('project-action-confirm')
      await wait('document.getElementById("project-action-modal").hidden', 'source removed during chooser')
      assert.equal(await evaluate(sourceCard()), false)
      assert.equal(fs.existsSync(path.join(output, 'Missing source copy')), false)
      assert.ok(await evaluate('document.getElementById("project-manager-status").textContent.startsWith("This project can’t be found.")'))
    } finally { if (fs.existsSync(unavailable)) fs.renameSync(unavailable, source) }
    await evaluate(`window.dispatchEvent(new Event('focus'))`)
    await wait(sourceCard(), 'final restored source')
    assert.equal(hash(originalAudio), originalHash)
  } finally { dialog.showSaveDialog = originalDialog; dialog.showMessageBox = originalMessage; shell.trashItem = originalTrash }
  console.log(JSON.stringify({ event: 'project-manager-smoke', status: 'PASS', actions: 'menu/physical-rename/copy/move/delete/cancel/collision/missing-source/focus-refresh', media: 'original audio reference and copied artwork', guards: 'recent-only and closed-project' }))
}

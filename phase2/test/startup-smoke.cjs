const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { app, dialog } = require('electron')

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

module.exports = async function startupSmoke(win) {
  win.setContentSize(1000, 700)
  const capture = async name => {
    await delay(200)
    const image = await win.webContents.capturePage()
    fs.writeFileSync(path.join(process.env.PHASE2_STARTUP_SMOKE_DIR, name), image.toPNG())
  }
  win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    console.log(`[Renderer ${level}] ${message} (${sourceId}:${line})`)
  })

  const evaluate = expression => win.webContents.executeJavaScript(expression)
  async function waitFor(expression, label, timeout = 30000) {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      try {
        if (await evaluate(expression)) return
      } catch (err) {
        console.log(`waitFor evaluating [${expression}] error: ${err.message}`)
      }
      await delay(100)
    }
    throw new Error(`Timed out waiting for ${label}`)
  }
  async function click(id) {
    await evaluate(`document.getElementById(${JSON.stringify(id)}).click()`)
  }

  console.log('Step 1: Checking Project Manager visibility')
  await waitFor('!document.getElementById("project-manager-screen").hidden', 'project manager visible')
  assert.equal(await evaluate('document.getElementById("editor-screen").hidden'), true)
  await waitFor('document.getElementById("splash-screen").hidden', 'splash dismissed')
  await capture('project-manager-1000x700.png')

  // Verify empty state uses dashed SVG icon (no emoji)
  const emptyIconSvg = await evaluate('Boolean(document.querySelector(".empty-icon svg"))')
  assert.ok(emptyIconSvg, 'Empty state must use an SVG icon')

  console.log('Step 2: Checking buttons')
  assert.ok(await evaluate('Boolean(document.getElementById("pm-new-blank"))'))
  assert.ok(await evaluate('Boolean(document.getElementById("pm-new-template"))'))
  assert.ok(await evaluate('Boolean(document.getElementById("pm-open-project"))'))
  assert.ok(await evaluate('Boolean(document.getElementById("open-template-manager"))'))

  console.log('Step 3: Testing Template Manager')
  await click('open-template-manager')
  await waitFor('!document.getElementById("template-manager-modal").hidden', 'open template manager modal')
  await capture('template-manager-1000x700.png')
  const modalZ = await evaluate('parseInt(window.getComputedStyle(document.getElementById("template-manager-modal")).zIndex, 10)')
  const pmZ = await evaluate('parseInt(window.getComputedStyle(document.getElementById("project-manager-screen")).zIndex, 10)')
  assert.ok(modalZ > pmZ, 'Modal z-index must be higher than project manager screen')
  const factoryCount = await evaluate('document.querySelectorAll("#template-manager-builtins .template-manager-row").length')
  assert.equal(factoryCount, 3)
  await evaluate('document.querySelector("#template-manager-builtins [data-action=use]").click()')
  await waitFor('!document.getElementById("editor-screen").hidden', 'editor visible after using a managed template')
  assert.equal(await evaluate('document.getElementById("project-manager-screen").hidden'), true)
  await click('close-project')
  await waitFor('!document.getElementById("project-manager-screen").hidden', 'project manager visible after closing managed template')

  console.log('Step 4: Testing New from Template')
  await click('pm-new-template')
  await waitFor('!document.getElementById("template-picker-modal").hidden', 'open template picker modal')
  const templateOptions = await evaluate('Array.from(document.querySelectorAll("#template-picker-select option"), o => o.value)')
  assert.ok(templateOptions.includes('starter:Studio Dashboard'))

  await evaluate('(() => { const sel = document.getElementById("template-picker-select"); sel.value = "starter:Studio Dashboard"; return true })()')
  await click('template-picker-create')
  await waitFor('document.getElementById("template-picker-modal").hidden', 'template picker closed')
  await waitFor('!document.getElementById("editor-screen").hidden', 'editor visible after template selection')
  assert.equal(await evaluate('document.getElementById("project-manager-screen").hidden'), true)
  const clippedControls = await evaluate(`(() => {
    const bar = document.querySelector('.toolbar').getBoundingClientRect()
    return Array.from(document.querySelectorAll('.toolbar-actions button, .toolbar-actions select, .license-disclosure summary'))
      .filter(element => element.getClientRects().length)
      .filter(element => {
        const box = element.getBoundingClientRect()
        return box.left < 0 || box.right > innerWidth || box.top < bar.top || box.bottom > bar.bottom
      }).map(element => element.id || element.textContent.trim())
  })()`)
  assert.deepEqual(clippedControls, [], 'Toolbar controls must fit at 1000 × 700')

  const templateLayers = await evaluate('document.querySelectorAll(".layer-item").length')
  assert.ok(templateLayers > 0, 'Starter template should have layers')

  console.log('Step 5: Testing Return to Projects')
  await click('close-project')
  await waitFor('!document.getElementById("project-manager-screen").hidden', 'project manager visible after return')
  assert.equal(await evaluate('document.getElementById("editor-screen").hidden'), true)

  console.log('Step 6: Testing New Blank Project')
  await click('pm-new-blank')
  await waitFor('!document.getElementById("editor-screen").hidden', 'editor visible after new blank')
  assert.equal(await evaluate('document.querySelectorAll(".layer-item").length'), 0, 'Blank project must have zero layers')
  assert.equal(await evaluate('window.desktop.initial().then(value => value.project.version)'), 2,
    'Blank projects must support composition graphics and reusable templates')

  console.log('Step 7: Testing Save and Recent Projects')
  await evaluate(`(() => {
    const title = document.getElementById("title");
    title.value = "Startup Smoke Project";
    title.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`)
  await click('add-layer')
  await click('save-project')
  await waitFor('document.querySelector("#status").textContent.includes("Saved project:")', 'project save completed')
  const statusText = await evaluate('document.querySelector("#status").textContent')
  assert.ok(statusText.includes('saved-smoke-project'), 'Project must be saved inside dedicated subfolder')

  console.log('Step 8: Verifying Recent Project card')
  await click('close-project')
  await waitFor('!document.getElementById("project-manager-screen").hidden', 'project manager visible')
  await waitFor('document.querySelectorAll("#recent-projects-grid .project-card").length > 0', 'recent projects card rendered')

  const cardTitle = await evaluate('document.querySelector("#recent-projects-grid .project-card-title").textContent')
  assert.equal(cardTitle, 'Startup Smoke Project')
  const cardPath = await evaluate('document.querySelector("#recent-projects-grid .project-card-path").textContent')
  assert.ok(cardPath.includes('saved-smoke-project'), 'Card path must point to encapsulated folder')
  const unlistedPath = path.join(process.env.PHASE5_TEST_USER_DATA, 'workflow-preferences.json')
  const rejectedUnlisted = await evaluate(`window.desktop.openProjectPath(${JSON.stringify(unlistedPath)})
    .then(() => false, error => String(error).includes('not in recent projects'))`)
  assert.equal(rejectedUnlisted, true, 'Recent-project IPC must reject other local files')

  console.log('Step 9: Testing Reopen from card')
  await evaluate('document.querySelector("#recent-projects-grid .project-card").click()')
  await waitFor('!document.getElementById("editor-screen").hidden', 'editor visible after card click')
  const reopenedTitle = await evaluate('document.getElementById("title").value')
  assert.equal(reopenedTitle, 'Startup Smoke Project')

  await click('add-layer')
  assert.equal(await evaluate('document.title.endsWith(" *")'), true, 'An edited project must be marked dirty')
  await click('save-project-as')
  await waitFor('document.querySelector("#status").textContent.includes("Saved new project:")', 'Save As completed')
  assert.equal(await evaluate('document.title.endsWith(" *")'), false, 'Save As must clear the dirty indicator')

  console.log('Step 10: Testing Unsaved Changes Guard')
  // Mutate project to make it dirty
  await click('add-layer')
  win.close()
  await waitFor('!document.getElementById("unsaved-changes-modal").hidden', 'unsaved changes modal on window close')
  await click('unsaved-changes-cancel')
  await waitFor('document.getElementById("unsaved-changes-modal").hidden', 'window close cancelled')
  assert.equal(win.isDestroyed(), false, 'Cancelling window close must keep the editor open')
  const originalOpenDialog = dialog.showOpenDialog
  dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] })
  try {
    await click('open-project')
    await waitFor('!document.getElementById("unsaved-changes-modal").hidden', 'unsaved changes modal before open')
    await click('unsaved-changes-discard')
    await waitFor('document.getElementById("unsaved-changes-modal").hidden', 'unsaved changes modal closed after discard')
    assert.equal(await evaluate('document.getElementById("editor-screen").hidden'), false)
    assert.equal(await evaluate('document.title.endsWith(" *")'), true,
      'Cancelling the open dialog after Discard must preserve the dirty state')
  } finally {
    dialog.showOpenDialog = originalOpenDialog
  }
  // Try to return to projects - should be intercepted by unsaved changes modal
  await click('close-project')
  await waitFor('!document.getElementById("unsaved-changes-modal").hidden', 'unsaved changes modal shown')
  assert.equal(await evaluate('document.getElementById("project-manager-screen").hidden'), true)

  // Cancel should abort return and keep editor open
  await click('unsaved-changes-cancel')
  await waitFor('document.getElementById("unsaved-changes-modal").hidden', 'modal closed on cancel')
  assert.equal(await evaluate('document.getElementById("editor-screen").hidden'), false)

  // Try again and click Discard
  await click('close-project')
  await waitFor('!document.getElementById("unsaved-changes-modal").hidden', 'unsaved changes modal shown second time')
  await click('unsaved-changes-discard')
  await waitFor('!document.getElementById("project-manager-screen").hidden', 'returned to project manager after discard')
  assert.equal(await evaluate('document.getElementById("editor-screen").hidden'), true)

  console.log('Step 11: Testing Close Project button and layout options removal from sidebar')
  await evaluate('document.querySelector("#recent-projects-grid .project-card").click()')
  await waitFor('!document.getElementById("editor-screen").hidden', 'editor visible after card click')

  // Verify sidebar does not contain template controls
  assert.equal(await evaluate('Boolean(document.querySelector(".layers-panel .template-controls"))'), false, 'Sidebar must not contain template controls')

  // Verify Projects button was removed and Close Project exists
  assert.equal(await evaluate('Boolean(document.getElementById("return-to-projects"))'), false, 'Projects button should be removed')
  // Verify Close Project and Save as template buttons exist in toolbar
  assert.equal(await evaluate('document.getElementById("close-project").textContent'), 'Close project')
  assert.equal(await evaluate('document.getElementById("save-template").textContent'), 'Save as template…')

  // Test Save as Template modal opens with top-right close button
  await click('save-template')
  await waitFor('!document.getElementById("save-template-modal").hidden', 'save template modal visible')
  await capture('save-template-1000x700.png')
  await click('save-template-close')
  await waitFor('document.getElementById("save-template-modal").hidden', 'save template modal closed via x')
  await click('save-template')
  await evaluate('document.getElementById("template-name").value = "Startup Smoke Layout"')
  await click('save-template-confirm')
  await waitFor('document.getElementById("save-template-modal").hidden', 'named template saved')

  // Clicking close-project returns to project manager
  await click('close-project')
  await waitFor('!document.getElementById("project-manager-screen").hidden', 'returned to project manager via close-project')
  assert.equal(await evaluate('document.getElementById("editor-screen").hidden'), true)
  await click('open-template-manager')
  await waitFor('!document.getElementById("template-manager-modal").hidden', 'template manager reopened')
  assert.equal(await evaluate('document.querySelector("#template-manager-custom .template-manager-name").textContent'),
    'Startup Smoke Layout', 'Named template must appear in the manager')
  await click('template-manager-close')

  console.log(JSON.stringify({ event: 'startup-smoke', status: 'PASS' }))
  app.quit()
}

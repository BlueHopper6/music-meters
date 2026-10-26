const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { app } = require('electron')

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

module.exports = async function startupSmoke(win) {
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
  const modalZ = await evaluate('parseInt(window.getComputedStyle(document.getElementById("template-manager-modal")).zIndex, 10)')
  const pmZ = await evaluate('parseInt(window.getComputedStyle(document.getElementById("project-manager-screen")).zIndex, 10)')
  assert.ok(modalZ > pmZ, 'Modal z-index must be higher than project manager screen')
  const factoryCount = await evaluate('document.querySelectorAll("#template-manager-builtins .template-manager-row").length')
  assert.equal(factoryCount, 3)
  await click('template-manager-close')
  await waitFor('document.getElementById("template-manager-modal").hidden', 'close template manager modal')

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

  console.log('Step 9: Testing Reopen from card')
  await evaluate('document.querySelector("#recent-projects-grid .project-card").click()')
  await waitFor('!document.getElementById("editor-screen").hidden', 'editor visible after card click')
  const reopenedTitle = await evaluate('document.getElementById("title").value')
  assert.equal(reopenedTitle, 'Startup Smoke Project')

  console.log('Step 10: Testing Unsaved Changes Guard')
  // Mutate project to make it dirty
  await click('add-layer')
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
  await click('save-template-close')
  await waitFor('document.getElementById("save-template-modal").hidden', 'save template modal closed via x')

  // Clicking close-project returns to project manager
  await click('close-project')
  await waitFor('!document.getElementById("project-manager-screen").hidden', 'returned to project manager via close-project')
  assert.equal(await evaluate('document.getElementById("editor-screen").hidden'), true)

  console.log(JSON.stringify({ event: 'startup-smoke', status: 'PASS' }))
  app.quit()
}

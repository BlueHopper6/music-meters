const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { app, dialog } = require('electron')

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

module.exports = async function startupSmoke(win) {
  assert.equal(app.getName(), 'MusicMeters')
  assert.equal(app.getPath('userData'), process.env.PHASE5_TEST_USER_DATA)
  win.setContentSize(1000, 700)
  const capture = async name => {
    if (!win.isVisible()) win.showInactive()
    win.webContents.invalidate()
    await delay(350)
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
  async function shortcut(keyCode, shift = false) {
    win.focus(); win.webContents.focus()
    const modifiers = shift ? ['control', 'shift'] : ['control']
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
    await delay(100)
  }

  console.log('Step 1: Checking Project Manager visibility')
  await waitFor('!document.getElementById("project-manager-screen").hidden', 'project manager visible')
  assert.equal(await evaluate('document.getElementById("editor-screen").hidden'), true)
  await waitFor('document.getElementById("splash-screen").hidden', 'splash dismissed')
  assert.equal(await evaluate('document.title'), 'MusicMeters')
  assert.equal(await evaluate('document.getElementById("window-project-title").hidden'), true)
  assert.equal(await evaluate('document.getElementById("window-project-title").textContent'), '')
  assert.equal(await evaluate('document.querySelector(".command-toolbar").getClientRects().length'), 0)
  assert.equal(await evaluate('document.querySelector(".pm-title").textContent'), 'Project Manager')
  assert.equal(await evaluate('document.querySelectorAll(".pm-header img, .toolbar img, .splash-logo").length'), 0)
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
  assert.equal(factoryCount, require('../templates.cjs').BUILTINS.length)
  await evaluate('document.querySelector("#template-manager-builtins [data-action=use]").click()')
  await waitFor('!document.getElementById("editor-screen").hidden', 'editor visible after using a managed template')
  assert.equal(await evaluate('document.getElementById("project-manager-screen").hidden'), true)
  assert.equal(await evaluate('document.getElementById("window-project-title").hidden'), false)
  await click('close-project')
  await waitFor('!document.getElementById("project-manager-screen").hidden', 'project manager visible after closing managed template')
  assert.equal(await evaluate('document.title'), 'MusicMeters')
  assert.equal(await evaluate('document.getElementById("window-project-title").textContent'), '')

  console.log('Step 4: Testing New from Template')
  await click('pm-new-template')
  await waitFor('!document.getElementById("template-picker-modal").hidden', 'open template picker modal')
  const templateOptions = await evaluate('Array.from(document.querySelectorAll("#template-picker-select option"), o => o.value)')
  assert.ok(templateOptions.includes('starter:Observatory'))

  await evaluate('(() => { const sel = document.getElementById("template-picker-select"); sel.value = "starter:Observatory"; return true })()')
  await click('template-picker-create')
  await waitFor('document.getElementById("template-picker-modal").hidden', 'template picker closed')
  await waitFor('!document.getElementById("editor-screen").hidden', 'editor visible after template selection')
  assert.equal(await evaluate('document.getElementById("project-manager-screen").hidden'), true)
  const clippedControls = await evaluate(`(() => {
    const bar = document.querySelector('.toolbar').getBoundingClientRect()
    return Array.from(document.querySelectorAll('.menu-trigger, .toolbar-primary-actions button'))
      .filter(element => element.getClientRects().length)
      .filter(element => {
        const box = element.getBoundingClientRect()
        return box.left < 0 || box.right > innerWidth || box.top < bar.top || box.bottom > bar.bottom
      }).map(element => element.id || element.textContent.trim())
  })()`)
  assert.deepEqual(clippedControls, [], 'Toolbar controls must fit at 1000 × 700')

  const caption = await evaluate(`(() => {
    const bar = document.querySelector('.command-toolbar').getBoundingClientRect()
    const title = document.getElementById('window-project-title')
    const controls = document.querySelector('.window-controls').getBoundingClientRect()
    const brand = document.querySelector('.app-titlebar strong').getBoundingClientRect()
    return { top: bar.top, bottom: bar.bottom, left: bar.left, right: bar.right,
      brandRight: brand.right, controlsLeft: controls.left,
      workspaceTop: document.querySelector('.workspace').getBoundingClientRect().top,
      drag: getComputedStyle(document.querySelector('.command-toolbar')).webkitAppRegion,
      menusDrag: getComputedStyle(document.querySelector('.command-menus')).webkitAppRegion,
      actionsDrag: getComputedStyle(document.querySelector('.toolbar-primary-actions')).webkitAppRegion,
      titleWidth: title.getBoundingClientRect().width }
  })()`)
  assert.equal(caption.top, 0); assert.equal(caption.bottom, 40)
  assert.equal(caption.workspaceTop, 40)
  assert.ok(caption.left > caption.brandRight && caption.right <= caption.controlsLeft && caption.titleWidth >= 96)
  assert.equal(caption.drag, 'drag'); assert.equal(caption.menusDrag, 'no-drag'); assert.equal(caption.actionsDrag, 'no-drag')

  // Real pointer input verifies caption commands receive clicks in their no-drag region.
  const filePoint = await evaluate(`(() => { const r = document.getElementById('toolbar-file').getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()`)
  win.webContents.sendInputEvent({ type: 'mouseDown', ...filePoint, button: 'left', clickCount: 1 })
  win.webContents.sendInputEvent({ type: 'mouseUp', ...filePoint, button: 'left', clickCount: 1 })
  await waitFor('!document.getElementById("file-menu").hidden', 'caption File pointer click')
  await capture('titlebar-file-menu.png')
  await evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)

  await click('toolbar-file')
  assert.equal(await evaluate('document.getElementById("file-menu").hidden'), false)
  await evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))`)
  assert.equal(await evaluate('document.activeElement.id'), 'open-project')
  await evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
  assert.equal(await evaluate('document.activeElement.id'), 'toolbar-file')
  await shortcut('E')
  assert.equal(await evaluate('document.getElementById("export-modal").hidden'), false)
  assert.equal(await evaluate('document.activeElement.id'), 'export-preset')
  assert.equal(await evaluate('document.getElementById("render-mp4").disabled'), true)
  await capture('export-dialog-empty.png')
  await evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
  assert.equal(await evaluate('document.activeElement.id'), 'open-export')
  await click('toolbar-templates'); await click('manage-templates')
  await waitFor('!document.getElementById("template-manager-modal").hidden', 'editor template menu')
  await click('template-manager-close')
  assert.equal(await evaluate('document.activeElement.id'), 'toolbar-templates')
  await click('toolbar-help'); await click('show-license')
  assert.equal(await evaluate('document.getElementById("about-modal").hidden'), false)
  await click('about-close')
  assert.equal(await evaluate('document.activeElement.id'), 'toolbar-help')
  await capture('editor-command-toolbar.png')
  const templateLayers = await evaluate('document.querySelectorAll(".layer-item").length')
  assert.ok(templateLayers > 0, 'Starter template should have layers')

  console.log('Checking all designed factories with empty artwork and real audio')
  for (const name of require('../templates.cjs').BUILTINS) {
    await click('close-project')
    await waitFor('!document.getElementById("project-manager-screen").hidden', 'factory picker project manager')
    await click('pm-new-template')
    await waitFor('!document.getElementById("template-picker-modal").hidden', 'factory picker')
    await evaluate(`document.getElementById('template-picker-select').value = ${JSON.stringify(`starter:${name}`)}`)
    await click('template-picker-create')
    await waitFor('!document.getElementById("editor-screen").hidden && document.getElementById("template-picker-modal").hidden', name)
    const initial = await evaluate('window.desktop.initial()')
    const expected = require('../templates.cjs').starter(name)
    assert.deepEqual(initial.project.layers, expected.layers)
    assert.equal(initial.missingMedia.length, 0)
    await click('import-audio')
    await waitFor('document.getElementById("status").textContent.includes("Real Prism")', `${name} audio import`)
    await evaluate(`(() => { const time = document.getElementById('time-input'); time.value = '4';
      time.dispatchEvent(new Event('change', { bubbles: true })); })()`)
    await waitFor('document.getElementById("stage").dataset.previewFrame === "120" && document.getElementById("playback-cancel").hidden', `${name} seek`)
    await click('refresh-still')
    await waitFor('document.getElementById("status").textContent.includes("Real Prism meter still at 4.00 s.")', `${name} full-history still`)
    const frame = await evaluate('document.getElementById("stage").toDataURL("image/png").split(",")[1]')
    fs.writeFileSync(path.join(process.env.PHASE2_STARTUP_SMOKE_DIR, `${name.toLowerCase().replaceAll(' ', '-')}.png`), Buffer.from(frame, 'base64'))
    await capture(`${name.toLowerCase().replaceAll(' ', '-')}-editor.png`)
    if (name === 'Observatory') {
      const change = (id, value, type = 'change') => evaluate(`(() => {
        const el = document.getElementById(${JSON.stringify(id)});
        if (el.type === 'checkbox') el.checked = ${JSON.stringify(value)};
        else el.value = ${JSON.stringify(String(value))};
        el.dispatchEvent(new Event(${JSON.stringify(type)}, { bubbles: true })); })()`)
      const styled = expected.layers.filter(layer => !['text', 'image'].includes(layer.type)
        || layer.name === 'song name')
      for (const layer of styled) {
        await evaluate(`document.querySelector('[data-id="${layer.id}"]').click()`)
        assert.equal(await evaluate('document.getElementById("layer-background-options").hidden'), false)
        await change('layer-background-enabled', true)
        await change('layer-background-color', '#ffffff', 'input')
        const pixel = await evaluate(`Array.from(document.getElementById('stage').getContext('2d')
          .getImageData(${layer.x + 1}, ${layer.y + 1}, 1, 1).data).slice(0, 3)`)
        assert.ok(pixel.every(value => value >= 250), `${layer.type} background must fill its box: ${pixel}`)
      }
      const spectrum = expected.layers.find(layer => layer.type === 'spectrum')
      await evaluate(`document.querySelector('[data-id="${spectrum.id}"]').click()`)
      await change('layer-background-color', '#80c040', 'input')
      await change('layer-background-opacity', 50)
      const blended = await evaluate(`Array.from(document.getElementById('stage').getContext('2d')
        .getImageData(${spectrum.x + 1}, ${spectrum.y + 1}, 1, 1).data).slice(0, 3)`)
      const expectedBlend = [69, 103, 44]
      assert.ok(blended.every((value, index) => Math.abs(value - expectedBlend[index]) <= 2), `Independent background alpha: ${blended}`)
      await change('layer-locked', true)
      assert.equal(await evaluate('document.getElementById("layer-background-enabled").disabled'), true)
      assert.equal(await evaluate('document.getElementById("layer-background-color").disabled'), true)
      await change('layer-locked', false)
      const originalSave = process.env.PHASE2_TEST_SAVE_PATH
      process.env.PHASE2_TEST_SAVE_PATH = path.join(process.env.PHASE2_STARTUP_SMOKE_DIR, 'layer-background-project.json')
      try {
        await click('save-project')
        await waitFor('document.getElementById("status").textContent.includes("Saved project:")', 'save layer backgrounds')
        const savedFile = path.join(process.env.PHASE2_STARTUP_SMOKE_DIR, 'layer-background-project', 'layer-background-project.json')
        const saved = JSON.parse(fs.readFileSync(savedFile, 'utf8'))
        assert.equal(saved.layers.find(layer => layer.id === spectrum.id).backgroundOpacity, 0.5)
        assert.ok(saved.layers.filter(layer => layer.backgroundEnabled).length === 9)
        fs.writeFileSync(path.join(process.env.PHASE2_STARTUP_SMOKE_DIR, 'layer-backgrounds.png'),
          Buffer.from(await evaluate('document.getElementById("stage").toDataURL("image/png").split(",")[1]'), 'base64'))
        await capture('layer-background-controls.png')
        // Reopen the actual saved project through the recent-project API.
        await click('close-project')
        await waitFor('!document.getElementById("project-manager-screen").hidden', 'close saved background project')
        await evaluate(`Array.from(document.querySelectorAll('#recent-projects-grid .project-card'))
          .find(card => card.textContent.includes('layer-background-project')).click()`)
        await waitFor('!document.getElementById("editor-screen").hidden', 'reopen saved layer backgrounds')
        await evaluate(`document.querySelector('[data-id="${spectrum.id}"]').click()`)
        assert.equal(await evaluate('document.getElementById("layer-background-color").value'), '#80c040')
        assert.equal(await evaluate('document.getElementById("layer-background-opacity").value'), '50')
      } finally { process.env.PHASE2_TEST_SAVE_PATH = originalSave }
      await change('layer-background-enabled', false)
      assert.equal(await evaluate('document.getElementById("layer-background-color").disabled'), true)
      const transparent = await evaluate(`Array.from(document.getElementById('stage').getContext('2d')
        .getImageData(${spectrum.x + 1}, ${spectrum.y + 1}, 1, 1).data).slice(0, 3)`)
      assert.deepEqual(transparent, [9, 14, 23], 'Disabling the background restores transparency')
      await evaluate('document.querySelector("[data-id=observatory-artwork]").click()')
      assert.equal(await evaluate('document.getElementById("layer-background-options").hidden'), true)
    }
    await click('close-project')
    await waitFor('!document.getElementById("unsaved-changes-modal").hidden', 'discard factory fixture changes')
    await click('unsaved-changes-discard')
    await waitFor('!document.getElementById("project-manager-screen").hidden', 'factory fixture closed')
    // Leave a clean template open for the remaining startup workflow checks.
    await click('pm-new-template')
    await waitFor('!document.getElementById("template-picker-modal").hidden', 'return factory picker')
    await evaluate('document.getElementById("template-picker-select").value = "starter:Observatory"')
    await click('template-picker-create')
    await waitFor('!document.getElementById("editor-screen").hidden', 'clean template restored')
  }

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
    title.value = "Untitled project";
    title.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`)
  await click('add-layer')
  await click('import-audio')
  await waitFor('document.getElementById("status").textContent.includes("Real Prism")', 'imported song preview')
  await evaluate(`(() => {
    const time = document.getElementById('time-input'); time.value = '4';
    time.dispatchEvent(new Event('change', { bubbles: true })); return true;
  })()`)
  await waitFor('document.getElementById("stage").dataset.previewFrame === "120" && document.getElementById("playback-cancel").hidden', 'fast preview at saved marker')
  await click('refresh-still')
  await waitFor('document.getElementById("status").textContent.includes("Real Prism meter still at 4.00 s.")', 'full-history preview at saved marker')
  await click('save-project')
  await waitFor('document.querySelector("#status").textContent.includes("Saved project:")', 'project save completed')
  const statusText = await evaluate('document.querySelector("#status").textContent')
  assert.ok(statusText.includes('saved-smoke-project'), 'Project must be saved inside dedicated subfolder')
  const savedPath = path.join(path.dirname(process.env.PHASE2_TEST_SAVE_PATH), 'saved-smoke-project', 'saved-smoke-project.json')
  assert.equal(JSON.parse(fs.readFileSync(savedPath, 'utf8')).previewFrame, 120)

  console.log('Step 8: Verifying Recent Project card')
  await click('close-project')
  await waitFor('!document.getElementById("project-manager-screen").hidden', 'project manager visible')
  await waitFor('document.querySelectorAll("#recent-projects-grid .project-card").length > 0', 'recent projects card rendered')

  const cardTitle = await evaluate('document.querySelector("#recent-projects-grid .project-card-title").textContent')
  assert.equal(cardTitle, 'saved-smoke-project', 'Placeholder project titles must fall back to the saved filename')
  const cardPath = await evaluate('document.querySelector("#recent-projects-grid .project-card-path").textContent')
  assert.ok(cardPath.includes('saved-smoke-project'), 'Card path must point to encapsulated folder')
  const unlistedPath = path.join(process.env.PHASE5_TEST_USER_DATA, 'workflow-preferences.json')
  const rejectedUnlisted = await evaluate(`window.desktop.openProjectPath(${JSON.stringify(unlistedPath)})
    .then(() => false, error => String(error).includes('not in recent projects'))`)
  assert.equal(rejectedUnlisted, true, 'Recent-project IPC must reject other local files')

  console.log('Step 9: Testing Reopen from card')
  await evaluate(`(() => {
    window.projectOpenPreviewStates = [];
    const busy = document.getElementById('preview-busy');
    window.projectOpenPreviewObserver = new MutationObserver(() => {
      if (!busy.hidden) window.projectOpenPreviewStates.push({
        editorVisible: !document.getElementById('editor-screen').hidden,
        managerHidden: document.getElementById('project-manager-screen').hidden,
        message: busy.textContent,
      });
    });
    window.projectOpenPreviewObserver.observe(busy, { attributes: true, attributeFilter: ['hidden'] });
    return true;
  })()`)
  await evaluate('document.querySelector("#recent-projects-grid .project-card").click()')
  await waitFor('!document.getElementById("editor-screen").hidden', 'editor visible after card click')
  const reopenedTitle = await evaluate('document.getElementById("title").value')
  assert.equal(reopenedTitle, 'Untitled project')
  assert.equal(await evaluate('Number(document.getElementById("time-input").value)'), 4,
    'Reopening must restore the saved preview marker')
  await waitFor('document.getElementById("status").textContent.includes("Real Prism meter still at 4.00 s.")', 'restored marker preview')
  const previewStates = await evaluate('window.projectOpenPreviewStates')
  assert.ok(previewStates.length > 0, 'Reopening audio must report preview analysis')
  assert.ok(previewStates.every(state => state.editorVisible && state.managerHidden),
    `Preview analysis must run in the editor, not the Project Manager: ${JSON.stringify(previewStates)}`)
  assert.equal(previewStates[0].message, 'Analyzing preview at 4.00 s…')
  await evaluate('window.projectOpenPreviewObserver.disconnect()')
  assert.equal(await evaluate('document.title.endsWith(" *")'), false, 'Reopening at the saved marker must not make the project dirty')

  // Closing while a reopened preview is pending must not bounce back into the editor.
  await click('close-project')
  await waitFor('!document.getElementById("project-manager-screen").hidden', 'manager before pending-preview close')
  await evaluate(`(() => {
    const busy = document.getElementById('preview-busy');
    const observer = new MutationObserver(() => {
      if (!busy.hidden) {
        observer.disconnect(); document.getElementById('close-project').click();
      }
    });
    observer.observe(busy, { attributes: true, attributeFilter: ['hidden'] });
    document.querySelector('#recent-projects-grid .project-card').click(); return true;
  })()`)
  await waitFor('document.getElementById("status").textContent === "Project closed."', 'close during restored preview')
  await delay(300)
  assert.equal(await evaluate('document.getElementById("editor-screen").hidden'), true)
  assert.equal(await evaluate('document.getElementById("project-manager-screen").hidden'), false)
  await evaluate('document.querySelector("#recent-projects-grid .project-card").click()')
  await waitFor('document.getElementById("status").textContent.includes("Real Prism meter still at 4.00 s.")', 'reopen after cancelling preview')

  await click('add-layer')
  assert.equal(await evaluate('document.title.endsWith(" *")'), true, 'An edited project must be marked dirty')
  await shortcut('S', true)
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
  assert.equal(await evaluate('document.getElementById("close-project").childNodes[0].textContent'), 'Close project')
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

  // Custom caption close must take the same dirty-guard path as OS close.
  await click('pm-new-blank')
  await waitFor('!document.getElementById("editor-screen").hidden', 'blank editor for caption close')
  await evaluate(`(() => { const input = document.getElementById('title'); input.value = 'Unsaved caption close';
    input.dispatchEvent(new Event('input', { bubbles: true })); })()`)
  assert.equal(await evaluate('document.title.endsWith("*")'), true)
  await click('open-export')
  await click('window-close')
  await waitFor('!document.getElementById("unsaved-changes-modal").hidden', 'caption close dirty guard')
  assert.equal(await evaluate('document.getElementById("export-modal").hidden && !document.getElementById("editor-screen").inert'), true)
  await click('unsaved-changes-cancel')
  assert.equal(win.isDestroyed(), false)
  await click('toolbar-file')
  await click('quit-app')
  await waitFor('!document.getElementById("unsaved-changes-modal").hidden', 'File Quit dirty guard')
  await click('unsaved-changes-cancel')
  assert.equal(win.isDestroyed(), false)
  assert.equal(await evaluate('document.title.endsWith("*")'), true)

  // Canceling the native Save dialog during Quit must preserve the dirty project.
  const originalSaveDialog = dialog.showSaveDialog
  dialog.showSaveDialog = async () => ({ canceled: true, filePath: undefined })
  const originalSavePath = process.env.PHASE2_TEST_SAVE_PATH
  delete process.env.PHASE2_TEST_SAVE_PATH
  try {
    await click('toolbar-file'); await click('quit-app')
    await waitFor('!document.getElementById("unsaved-changes-modal").hidden', 'Quit save prompt')
    await click('unsaved-changes-save')
    await delay(150)
    assert.equal(win.isDestroyed(), false)
    assert.equal(await evaluate('document.title.endsWith("*")'), true)
  } finally {
    dialog.showSaveDialog = originalSaveDialog
    if (originalSavePath !== undefined) process.env.PHASE2_TEST_SAVE_PATH = originalSavePath
  }
  await shortcut('W')
  await waitFor('!document.getElementById("unsaved-changes-modal").hidden', 'Ctrl+W project-close guard before shutdown')
  await click('unsaved-changes-discard')
  await waitFor('!document.getElementById("project-manager-screen").hidden', 'project manager after caption close cancelled')
  win.once('closed', () => console.log(JSON.stringify({ event: 'startup-smoke', status: 'PASS',
    captionClose: 'dirty guard and cancel preserved', quit: 'File guard, cancelled save, Project Manager shutdown' })))
  await click('pm-quit')
}

const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { app } = require('electron')

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

module.exports = async function previewPerformanceSmoke(win) {
  const dir = process.env.PHASE6_PREVIEW_PERF_DIR
  const evaluate = source => win.webContents.executeJavaScript(source)
  async function waitFor(source, label, timeout = 90000) {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      if (await evaluate(source)) return
      await delay(100)
    }
    throw new Error(`Timed out waiting for ${label}: ${await evaluate('document.getElementById("status").textContent')}`)
  }
  async function setTime(seconds) {
    await evaluate(`(() => { const input = document.getElementById('time-input');
      input.value = ${JSON.stringify(String(seconds))}; input.dispatchEvent(new Event('change', { bubbles: true })); return true })()`)
    await waitFor(`document.getElementById('stage').dataset.previewFrame === '${Math.round(seconds * 30)}' && document.getElementById('playback-cancel').hidden`, 'fast seek')
    await evaluate('document.getElementById("refresh-still").click()')
  }
  function digest(value) { return createHash('sha256').update(value).digest('hex') }
  async function still(name) {
    const base64 = await evaluate('document.getElementById("stage").toDataURL("image/png").split(",")[1]')
    const image = Buffer.from(base64, 'base64')
    fs.writeFileSync(path.join(dir, name), image)
    return digest(image)
  }

  await waitFor('document.getElementById("status").textContent.includes("Real Prism")', 'initial still')
  await setTime(119)
  await waitFor('document.getElementById("status").textContent.includes("119.00 s") && document.getElementById("preview-busy").hidden', 'late vector still')
  const before = await still('before-additions.png')

  const addLatencies = []
  for (const type of ['spectrum', 'spectrogram', 'waveform', 'vu', 'loudness', 'waterfall']) {
    const start = Date.now()
    await evaluate(`(() => { document.getElementById('add-type').value = ${JSON.stringify(type)};
      document.getElementById('add-layer').click(); return true })()`)
    addLatencies.push(Date.now() - start)
  }
  await evaluate('document.getElementById("duplicate-layer").click()')
  assert.equal(await evaluate('document.querySelectorAll(".layer-item").length'), 8)
  await delay(400)
  assert.equal(await evaluate('document.getElementById("preview-busy").hidden'), true,
    'Layer additions must not start background analysis')
  assert.equal(await evaluate('document.getElementById("preview-stale").hidden'), false)
  assert.match(await evaluate('document.getElementById("status").textContent'), /out of date/)
  const layoutStart = Date.now()
  await evaluate(`(() => { const input = document.getElementById('layer-x');
    input.value = String(Number(input.value) + 15); input.dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('layer-down').click(); document.getElementById('layer-up').click();
    return true })()`)
  const layoutMs = Date.now() - layoutStart
  assert.equal(await evaluate('document.getElementById("preview-stale").hidden'), false)
  const stale = await still('stale-layout.png')
  assert.notEqual(stale, before, 'Lightweight layout should update the stage')

  const refreshStart = Date.now()
  await evaluate('document.getElementById("refresh-still").click()')
  const pingLatencies = []
  while (!(await evaluate('document.getElementById("preview-stale").hidden && document.getElementById("status").textContent.includes("119.00 s")'))) {
    if (Date.now() - refreshStart > 90000) throw new Error('Late multi-meter refresh timed out')
    const pingStart = Date.now()
    await evaluate('window.desktop.initial().then(() => true)')
    pingLatencies.push(Date.now() - pingStart)
    await delay(100)
  }
  const refreshMs = Date.now() - refreshStart
  const refreshed = await still('refreshed-119.png')
  assert.notEqual(refreshed, stale, 'Refresh should replace stale meter data')
  assert.ok(Math.max(...pingLatencies) < 1000,
    `Electron main process stopped answering during Refresh: ${Math.max(...pingLatencies)} ms`)

  const cachedStart = Date.now()
  await evaluate('document.getElementById("refresh-still").click()')
  await waitFor('document.getElementById("preview-stale").hidden && document.getElementById("status").textContent.includes("119.00 s")', 'cached refresh')
  const cachedMs = Date.now() - cachedStart
  assert.equal(await still('refreshed-119-repeat.png'), refreshed)

  await setTime(118)
  await delay(1500)
  const cancelStart = Date.now()
  await setTime(1)
  await waitFor('document.getElementById("preview-stale").hidden && document.getElementById("status").textContent.includes("Real Prism meter still at 1.00 s")', 'superseding early still')
  const cancellationMs = Date.now() - cancelStart
  await delay(1000)
  assert.match(await evaluate('document.getElementById("status").textContent'), /Real Prism meter still at 1\.00 s/)
  const summary = { layers: 8, timestampSeconds: 119, addLatencies, layoutMs, refreshMs,
    maxMainPingMs: Math.max(...pingLatencies), cachedMs, cancellationMs,
    before, stale, refreshed }
  fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n')
  console.log(JSON.stringify({ event: 'preview-performance-smoke', ...summary }))
  app.quit()
}

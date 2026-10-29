const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { performance } = require('node:perf_hooks')
const { app } = require('electron')
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
module.exports = async function playbackSmoke(win, playback) {
  const dir = process.env.PHASE2_PLAYBACK_DIR
  const evaluate = code => win.webContents.executeJavaScript(code)
  async function wait(code, label, timeout = 12000) {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      if (await evaluate(code)) return
      await delay(30)
    }
    const state = await evaluate(`(() => { const audio = document.getElementById('playback-audio'); return {
      status: document.getElementById('playback-status').textContent, time: audio.currentTime, seeking: audio.seeking, paused: audio.paused,
      slider: document.getElementById('time-slider').value, frame: document.getElementById('stage').dataset.previewFrame, focus: document.activeElement.id }; })()`)
    throw new Error(`${label}: ${JSON.stringify(state)}`)
  }
  const click = id => evaluate(`document.getElementById(${JSON.stringify(id)}).click()`)
  const seek = seconds => evaluate(`(() => { const el = document.getElementById('time-input'); el.value = ${JSON.stringify(String(seconds))}; el.dispatchEvent(new Event('change', { bubbles: true })); })()`)
  await wait('document.getElementById("status").textContent.includes("Real Prism meter still")', 'initial still')
  win.showInactive(); win.setContentSize(1000, 780)
  for (const type of ['spectrum', 'oscilloscope', 'spectrogram', 'waveform', 'vu', 'loudness', 'waterfall']) {
    await evaluate(`document.getElementById('add-type').value = ${JSON.stringify(type)}; document.getElementById('add-layer').click()`)
  }
  // A second FFT configuration must not share Prism's process-global native state.
  await evaluate(`document.getElementById('add-type').value = 'spectrum'; document.getElementById('add-layer').click()`)
  await evaluate(`(() => { const el = document.getElementById('spectrum-fft'); if (el) { el.value = '8192'; el.dispatchEvent(new Event('change', { bubbles: true })); } })()`)
  await click('save-project'); await wait('!document.title.endsWith("*")', 'saved clean project')
  await click('playback-muted')
  process.env.PHASE6_TEST_ENCODER = path.join(dir, 'no-video-encoder.exe')
  let packets = []
  const originalPull = playback.pull.bind(playback)
  playback.pull = async (...args) => { const frames = await originalPull(...args); if (frames.length) packets = frames; return frames }
  assert.equal(await evaluate('document.getElementById("playback-stop") === null'), true)
  assert.equal(await evaluate('document.getElementById("time-input").hidden'), true)
  const firstSeekStarted = performance.now()
  await click('time-display')
  await evaluate(`(() => { const el = document.getElementById('time-input'); el.value = '00:30.000'; el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`)
  await wait('Math.abs(document.getElementById("playback-audio").currentTime - 30) < 0.1 && document.getElementById("playback-cancel").hidden', 'first seek uses fast live analysis')
  const firstSeekMs = performance.now() - firstSeekStarted
  assert.ok(firstSeekMs < 4000, `First seek took ${firstSeekMs}ms`)
  assert.equal(await evaluate('document.getElementById("playback-audio").paused'), true)
  assert.equal(await evaluate('document.getElementById("time-input").hidden'), true)
  assert.equal(await evaluate('document.title.endsWith("*")'), false)
  await click('time-display')
  await evaluate(`(() => { const el = document.getElementById('time-input'); el.value = '00:45.000'; el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); })()`)
  assert.equal(await evaluate('document.getElementById("time-display").textContent'), '00:30.000', 'Escape discards time entry')
  assert.equal(await evaluate('document.activeElement.id'), 'time-display')
  // A queued pause event from the old position must not reset a newer seek.
  await evaluate(`(() => { const slider = document.getElementById('time-slider'); slider.value = '600';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('playback-audio').dispatchEvent(new Event('pause')); })()`)
  assert.equal(await evaluate('document.getElementById("time-slider").value'), '600', 'Late pause must preserve the requested seek position')
  await wait('document.getElementById("stage").dataset.previewFrame === "600" && document.getElementById("playback-cancel").hidden', 'seek after late pause')
  async function press(keyCode, modifiers = []) {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
  }
  async function timelinePointer(fraction, drag = false) {
    const rect = await evaluate(`(() => { const r = document.getElementById('time-slider').getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`)
    const point = { x: Math.round(rect.x + rect.width * fraction), y: Math.round(rect.y + rect.height / 2) }
    win.webContents.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 })
    if (drag) win.webContents.sendInputEvent({ type: 'mouseMove', x: point.x + 12, y: point.y, button: 'left' })
    win.webContents.sendInputEvent({ type: 'mouseUp', x: point.x + (drag ? 12 : 0), y: point.y, button: 'left', clickCount: 1 })
    await wait('document.activeElement.id === "time-slider"', 'timeline gets pointer focus')
    const expected = await evaluate('Number(document.getElementById("time-slider").value) / 30')
    await wait(`Math.abs(document.getElementById('playback-audio').currentTime - ${expected}) < 0.1 && document.getElementById('playback-cancel').hidden`, 'pointer seek complete')
    const appearance = await evaluate(`(() => { const style = getComputedStyle(document.getElementById('time-slider'));
      return { outline: style.outlineStyle, shadow: style.boxShadow }; })()`)
    assert.deepEqual(appearance, { outline: 'none', shadow: 'none' }, 'Pointer interaction must not draw a box around the timeline')
  }
  for (const drag of [false, true]) {
    await timelinePointer(0.2, drag)
    await press('Space')
    await wait('!document.getElementById("playback-audio").paused', 'Space plays without leaving the timeline')
    assert.equal(await evaluate('document.activeElement.id'), 'time-slider')
    await press('Space')
    await wait('document.getElementById("playback-audio").paused', 'Space pauses without leaving the timeline')
    assert.equal(await evaluate('document.activeElement.id'), 'time-slider')
  }
  fs.writeFileSync(path.join(dir, 'timeline-pointer.png'), (await win.capturePage()).toPNG())
  // Native Tab navigation retains a visible keyboard focus cue on the playhead.
  win.focus(); win.webContents.focus()
  await evaluate('document.getElementById("time-slider").focus()')
  await press('Tab', ['shift'])
  await wait('document.activeElement.id !== "time-slider"', 'Shift+Tab leaves the timeline')
  await press('Tab')
  await wait('document.activeElement.id === "time-slider" && document.getElementById("time-slider").matches(":focus-visible")', 'Tab returns with visible keyboard focus')
  fs.writeFileSync(path.join(dir, 'timeline-keyboard.png'), (await win.capturePage()).toPNG())
  await press('Space')
  await wait('!document.getElementById("playback-audio").paused', 'keyboard-focused timeline supports Space')
  await press('Space')
  await wait('document.getElementById("playback-audio").paused', 'keyboard-focused timeline pauses')
  // Text entry and focused buttons retain their own native Space behavior.
  const originalTitle = await evaluate('document.getElementById("title").value')
  await evaluate('document.getElementById("title").focus()')
  await press('Space')
  await delay(150)
  assert.equal(await evaluate('document.getElementById("playback-audio").paused'), true)
  await evaluate(`(() => { const el = document.getElementById('title'); el.value = ${JSON.stringify(originalTitle)};
    el.dispatchEvent(new Event('input', { bubbles: true })); })()`)
  await evaluate('document.getElementById("playback-play").focus()')
  await press('Space')
  await wait('!document.getElementById("playback-audio").paused', 'focused Play button toggles only once')
  await press('Space')
  await wait('document.getElementById("playback-audio").paused', 'focused Pause button toggles only once')
  // Restore the existing exact-frame keyboard seek regression's starting point.
  await seek(30)
  await wait(`(() => { const audio = document.getElementById('playback-audio'); return audio.paused && !audio.seeking
    && Math.abs(audio.currentTime - 30) < 0.001 && document.getElementById('time-slider').value === '900'
    && document.getElementById('stage').dataset.previewFrame === '900' && document.getElementById('playback-cancel').hidden; })()`, 'return to exact frame 900')
  await evaluate('document.getElementById("time-slider").focus()')
  await wait('document.activeElement.id === "time-slider"', 'timeline focused for frame step')
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Right' })
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Right' })
  await wait('document.getElementById("stage").dataset.previewFrame === "901" && document.getElementById("playback-cancel").hidden', 'keyboard seek by one frame')
  const started = performance.now()
  await click('playback-play')
  await wait('!document.getElementById("playback-audio").paused && document.getElementById("playback-audio").currentTime > 30.25', 'responsive playback')
  const startupMs = performance.now() - started
  assert.ok(startupMs < 4000, `180-second song startup took ${startupMs}ms`)
  assert.equal(await evaluate('document.title.endsWith("*")'), false, 'playing is not an edit')
  assert.equal(await evaluate('document.getElementById("playback-play").getAttribute("aria-label")'), 'Pause preview')
  assert.equal(await evaluate('getComputedStyle(document.querySelector("#playback-play .pause-icon")).display'), 'block')
  assert.equal(await evaluate('document.querySelector("#playback-video") === null'), true, 'no pre-rendered video')
  assert.ok(await evaluate('document.getElementById("playback-audio").duration > 179'))
  await click('playback-play')
  const paused = await evaluate('document.getElementById("playback-audio").currentTime')
  await delay(250)
  assert.ok(Math.abs(await evaluate('document.getElementById("playback-audio").currentTime') - paused) < 0.05)
  const oldURL = playback.media.url
  const seekStarted = performance.now()
  await seek(120)
  await wait('Math.abs(document.getElementById("playback-audio").currentTime - 120) < 0.1 && document.getElementById("playback-cancel").hidden', 'late seek')
  const seekMs = performance.now() - seekStarted
  assert.ok(seekMs < 4000, `Seek to two minutes took ${seekMs}ms`)
  assert.notEqual(playback.media.url, oldURL, 'seek revokes old audio capability')
  assert.equal(await evaluate('document.title.endsWith("*")'), false, 'live seeking is not an edit')
  await click('playback-play')
  await wait('document.getElementById("playback-audio").currentTime > 120.8', 'late resume')
  assert.ok(packets.length)
  const latest = packets.at(-1)
  assert.equal(Object.keys(latest.spectra).length, 2, 'different FFT configurations remain isolated')
  assert.ok(latest.frameIndex >= 3600)
  assert.ok(Object.keys(latest.spectrograms).length && Object.keys(latest.waveforms).length && Object.keys(latest.vus).length && Object.keys(latest.loudness).length && Object.keys(latest.waterfalls).length)
  const fftKey = Object.keys(latest.spectra)[0]
  const magnitudes = Buffer.from(latest.spectra[fftKey].mid, 'base64')
  let peak = 0, level = -Infinity
  for (let i = 0; i < magnitudes.length / 4; i++) { const value = magnitudes.readFloatLE(i * 4); if (value > level) { peak = i; level = value } }
  const peakHz = peak * latest.sampleRate / Number(fftKey.split(':')[0])
  assert.ok(Math.abs(peakHz - 880) < 50, `Late-seek meter analyzed ${peakHz}Hz instead of the 880Hz late section`)
  const lag = await evaluate('Math.floor(document.getElementById("playback-audio").currentTime * 30) - Number(document.getElementById("stage").dataset.previewFrame)')
  assert.ok(lag >= -1 && lag < 5, `Meter frame lag ${lag}`)
  win.webContents.invalidate(); await delay(200)
  fs.writeFileSync(path.join(dir, 'live-landscape.png'), (await win.capturePage()).toPNG())
  await seek(25); await seek(65); await seek(125)
  await wait('Math.abs(document.getElementById("playback-audio").currentTime - 125) < 0.1 && document.getElementById("playback-cancel").hidden', 'latest rapid seek wins')
  await seek(5)
  await wait('!document.getElementById("playback-cancel").hidden', 'seek cancellation available')
  await click('playback-cancel')
  await wait('!document.getElementById("playback-play").disabled', 'cancel remains responsive')
  assert.equal(await evaluate('document.getElementById("playback-stop") === null'), true)
  await evaluate(`(() => { const el = document.getElementById('canvas-orientation'); el.value = 'portrait'; el.dispatchEvent(new Event('change', { bubbles: true })); })()`)
  await click('playback-play')
  await wait('!document.getElementById("playback-audio").paused && document.getElementById("playback-cancel").hidden', 'portrait live preview')
  assert.equal(await evaluate('document.getElementById("stage").height'), 1280)
  await seek(179.7)
  await wait('document.getElementById("playback-audio").ended', 'end of song')
  await click('playback-play')
  await wait('!document.getElementById("playback-audio").paused && document.getElementById("playback-audio").currentTime < 2', 'replay')
  win.webContents.invalidate(); await delay(200)
  fs.writeFileSync(path.join(dir, 'live-portrait.png'), (await win.capturePage()).toPNG())
  await click('close-project'); await click('unsaved-changes-discard')
  await wait('!document.getElementById("project-manager-screen").hidden', 'project close')
  assert.equal(await evaluate('document.getElementById("playback-audio").paused'), true)
  delete process.env.PHASE6_TEST_ENCODER
  const result = { event: 'playback-smoke', status: 'PASS', firstSeekMs, startupMs, seekMs, peakHz, frameLag: lag, duration: 180, meters: 8 }
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result))
  app.quit()
}

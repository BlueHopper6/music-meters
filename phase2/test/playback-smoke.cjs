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
    throw new Error(`${label}: ${await evaluate('document.getElementById("playback-status").textContent')}`)
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
  await click('playback-play'); await click('playback-cancel')
  await wait('!document.getElementById("playback-play").disabled', 'cancel remains responsive')
  const started = performance.now()
  await click('playback-play')
  await wait('!document.getElementById("playback-audio").paused && document.getElementById("playback-audio").currentTime > 0.25', 'responsive playback')
  const startupMs = performance.now() - started
  assert.ok(startupMs < 4000, `180-second song startup took ${startupMs}ms`)
  assert.equal(await evaluate('document.title.endsWith("*")'), false, 'playing is not an edit')
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
  await click('playback-stop')
  await wait('document.getElementById("playback-audio").getAttribute("src") === null', 'return to editing')
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
  const result = { event: 'playback-smoke', status: 'PASS', startupMs, seekMs, peakHz, frameLag: lag, duration: 180, meters: 8 }
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result))
  app.quit()
}

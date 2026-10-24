const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { performance } = require('node:perf_hooks')
const { PcmReader } = require('../pcm-reader.cjs')

const fixtures = path.resolve(__dirname, '..', '..', 'artifacts', 'phase1', 'fixtures')

test('streaming decoder preserves all stereo samples across irregular reads', async () => {
  const reader = new PcmReader(path.join(fixtures, 'stereo-10s-48k.wav'), 48000)
  let position = 0
  let readIndex = 0
  const sizes = [1, 257, 1600, 4093]
  try {
    while (position < 480000) {
      const size = Math.min(sizes[readIndex++ % sizes.length], 480000 - position)
      const chunk = await reader.readFrames(size)
      assert.equal(chunk.frames, size)
      for (let i = 0; i < size; i++) {
        const sample = position + i
        if (sample % 1000 !== 0) continue
        const expected = Math.trunc(0.72 * 32767 * Math.sin(2 * Math.PI * 440 * sample / 48000)) / 32768
        assert.ok(Math.abs(chunk.left[i] - expected) < 1e-5, `left sample ${sample}`)
        const section = Math.min(2, Math.floor(sample * 3 / 480000))
        const right = [expected, 0, -expected][section]
        assert.ok(Math.abs(chunk.right[i] - right) < 1e-5, `right sample ${sample}`)
      }
      position += size
    }
    assert.equal((await reader.readFrames(1)).frames, 0)
  } finally {
    await reader.close()
  }
})

test('mono 44.1 kHz source is duplicated only in analyzer PCM', async () => {
  const reader = new PcmReader(path.join(fixtures, 'mono-10s-44k.wav'), 44100)
  try {
    const chunk = await reader.readFrames(4410)
    assert.equal(chunk.frames, 4410)
    for (let i = 0; i < chunk.frames; i++) assert.equal(chunk.left[i], chunk.right[i])
  } finally {
    await reader.close()
  }
})

test('closing a partly consumed long decoder does not wait for buffered stdout', async () => {
  const reader = new PcmReader(path.join(fixtures, 'stereo-180s-48k.wav'), 48000)
  await reader.readFrames(1600)
  const started = performance.now()
  await reader.close()
  assert.ok(performance.now() - started < 5000)
})

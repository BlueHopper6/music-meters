const test = require('node:test')
const assert = require('node:assert/strict')
const { outputFormat, aacBitrate, validateOutputPath, validateAudioCopy } = require('../audio-output.cjs')

test('outputFormat and validateOutputPath enforce MP4/AAC and MKV/copy contracts', () => {
  assert.deepEqual(outputFormat(), { extension: '.mp4', container: 'MP4', audio: 'AAC up to 320 kb/s' })
  assert.deepEqual(outputFormat('aac'), { extension: '.mp4', container: 'MP4', audio: 'AAC up to 320 kb/s' })
  assert.deepEqual(outputFormat('copy'), { extension: '.mkv', container: 'MKV', audio: 'source audio stream copy' })
  assert.throws(() => outputFormat('opus'), /Unsupported audio export option/)
  assert.equal(validateOutputPath('C:/out/video.MP4', 'aac').container, 'MP4')
  assert.equal(validateOutputPath('C:/out/video.MKV', 'copy').container, 'MKV')
  assert.throws(() => validateOutputPath('C:/out/video.mkv', 'aac'), /MP4 output must end in \.mp4/)
  assert.throws(() => validateOutputPath('C:/out/video.mp4', 'copy'), /MKV output must end in \.mkv/)
})

test('aacBitrate requests 320k for standard stereo and explicit lower targets for mono and low-rate inputs', () => {
  for (const sampleRate of [44100, 48000, 88200, 96000, 192000]) {
    assert.equal(aacBitrate({ channels: 2, sampleRate }), '320k')
    assert.equal(aacBitrate({ channels: 1, sampleRate }), '160k')
  }
  assert.equal(aacBitrate({ channels: 2, sampleRate: 32000 }), '256k')
  assert.equal(aacBitrate({ channels: 1, sampleRate: 32000 }), '128k')
  assert.equal(aacBitrate({ channels: 2, sampleRate: 24000 }), '192k')
  assert.equal(aacBitrate({ channels: 1, sampleRate: 24000 }), '96k')
  assert.equal(aacBitrate({ channels: 2, sampleRate: 22050 }), '176k')
  assert.equal(aacBitrate({ channels: 1, sampleRate: 22050 }), '88k')
  assert.equal(aacBitrate({ channels: 2, sampleRate: 16000 }), '128k')
  assert.equal(aacBitrate({ channels: 1, sampleRate: 16000 }), '64k')
  assert.equal(aacBitrate({ channels: 2, sampleRate: 11025 }), '88k')
  assert.equal(aacBitrate({ channels: 1, sampleRate: 11025 }), '44k')
  assert.equal(aacBitrate({ channels: 2, sampleRate: 8000 }), '64k')
  assert.equal(aacBitrate({ channels: 1, sampleRate: 8000 }), '32k')

  for (const channels of [1, 2]) {
    for (const sampleRate of [8000, 9000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000, 96000, 192000]) {
      const targetBitsPerSec = Number(aacBitrate({ channels, sampleRate }).slice(0, -1)) * 1000
      const effectiveRate = Math.min(96000, sampleRate)
      const bitsPerFrame = (targetBitsPerSec * 1024) / effectiveRate
      assert.ok(bitsPerFrame <= 6144 * channels, `Exceeded AAC frame ceiling for ch=${channels} sr=${sampleRate}`)
    }
  }

  for (const bad of [{ channels: 0, sampleRate: 48000 }, { channels: 6, sampleRate: 48000 },
    { channels: 2, sampleRate: 7999 }, { channels: 2, sampleRate: 192001 }, { channels: 2, sampleRate: 48000.5 }]) {
    assert.throws(() => aacBitrate(bad), /Only mono or stereo|Unsupported sample rate/)
  }
})

test('validateAudioCopy preserves supported MKV stream-copy codecs and rejects unsupported ones', () => {
  assert.doesNotThrow(() => validateAudioCopy('track.mp3', { codecName: 'mp3' }))
  assert.doesNotThrow(() => validateAudioCopy('track.flac', { codecName: 'flac' }))
  for (const codecName of ['pcm_u8', 'pcm_s16le', 'pcm_s24le', 'pcm_s32le', 'pcm_f32le', 'pcm_f64le']) {
    assert.doesNotThrow(() => validateAudioCopy('track.wav', { codecName }))
  }
  assert.throws(() => validateAudioCopy('track.wav', { codecName: 'adpcm_ima_wav' }), /Cannot copy adpcm_ima_wav/)
  assert.throws(() => validateAudioCopy('track.mp3', { codecName: 'aac' }), /Cannot copy aac/)
})

const { extname } = require('node:path')

const FORMATS = Object.freeze({
  aac: { extension: '.mp4', container: 'MP4', audio: 'AAC up to 384 kb/s' },
  copy: { extension: '.mkv', container: 'MKV', audio: 'source audio stream copy' },
  flac: { extension: '.mkv', container: 'MKV', audio: '24-bit FLAC mix' },
  master: { extension: '.mkv', container: 'MKV', audio: '32-bit float PCM; lossless RGB video' },
})

const WAV_PCM = new Set(['pcm_u8', 'pcm_s16le', 'pcm_s24le', 'pcm_s32le',
  'pcm_f32le', 'pcm_f64le'])

function outputFormat(mode = 'aac') {
  if (!Object.hasOwn(FORMATS, mode)) throw new Error('Unsupported audio export option')
  return FORMATS[mode]
}

function validateOutputPath(output, mode = 'aac') {
  const format = outputFormat(mode)
  if (typeof output !== 'string' || extname(output).toLowerCase() !== format.extension) {
    throw new Error(`${format.container} output must end in ${format.extension}`)
  }
  return format
}

function validateAudioCopy(input, metadata) {
  const extension = extname(input).toLowerCase()
  const codec = metadata.codecName
  if ((extension === '.mp3' && codec === 'mp3')
      || (['.mp4', '.mov', '.mkv', '.webm', '.m4v', '.avi'].includes(extension) && ['aac', 'mp3', 'flac', 'opus', 'vorbis', ...WAV_PCM].includes(codec))
      || (extension === '.flac' && codec === 'flac')
      || (extension === '.wav' && WAV_PCM.has(codec))) return
  throw new Error(`Cannot copy ${codec || 'unknown'} audio from ${extension || 'this file'} into MKV. Use compatible MP4/AAC instead.`)
}

// Cap AAC at 192 kb/s per channel (384 kb/s stereo, 192 kb/s mono), using 4 bits
// per sample per channel below 44.1 kHz so low-rate inputs stay below FFmpeg's
// 6144-bit-per-channel AAC frame ceiling without relying on silent clamping.
function aacBitrate(metadata) {
  const channels = metadata?.channels
  const sampleRate = metadata?.sampleRate
  if (channels !== 1 && channels !== 2) {
    throw new Error(`Only mono or stereo audio is supported (found ${channels} channels)`)
  }
  if (!Number.isSafeInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000) {
    throw new Error(`Unsupported sample rate: ${sampleRate}`)
  }
  const kbps = sampleRate >= 44100 ? 192 * channels : Math.min(192 * channels, Math.floor((sampleRate * channels * 4) / 1000))
  return `${kbps}k`
}

module.exports = { outputFormat, aacBitrate, validateOutputPath, validateAudioCopy }

const { extname } = require('node:path')

const FORMATS = Object.freeze({
  aac: { extension: '.mp4', container: 'MP4', audio: 'AAC up to 320 kb/s' },
  copy: { extension: '.mkv', container: 'MKV', audio: 'source audio stream copy' },
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
      || (extension === '.flac' && codec === 'flac')
      || (extension === '.wav' && WAV_PCM.has(codec))) return
  throw new Error(`Cannot copy ${codec || 'unknown'} audio from ${extension || 'this file'} into MKV. Use compatible MP4/AAC instead.`)
}

// Cap AAC at 160 kb/s per channel (320 kb/s stereo, 160 kb/s mono) and 4 bits
// per sample per channel so low-sample-rate inputs stay well below FFmpeg's
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
  const kbps = Math.min(160 * channels, Math.floor((sampleRate * channels * 4) / 1000))
  return `${kbps}k`
}

module.exports = { outputFormat, aacBitrate, validateOutputPath, validateAudioCopy }

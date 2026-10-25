const { execFileSync } = require('node:child_process')
const { PcmReader } = require('../phase1/pcm-reader.cjs')

function probeAudio(input) {
  let raw
  try {
    raw = execFileSync('ffprobe', [
      '-v', 'error', '-show_entries', 'stream=codec_type,codec_name,channels,sample_rate,duration:format=duration',
      '-of', 'json', input,
    ], { encoding: 'utf8', maxBuffer: 1024 * 1024 })
  } catch (error) {
    throw new Error(`Could not read audio metadata: ${error.stderr?.toString().trim() || error.message}`)
  }
  const data = JSON.parse(raw)
  const stream = data.streams?.find(value => value.codec_type === 'audio')
  if (!stream) throw new Error('Input has no audio stream')
  const channels = Number(stream.channels)
  if (channels !== 1 && channels !== 2) throw new Error(`Only mono or stereo audio is supported (found ${channels} channels)`)
  const sampleRate = Number(stream.sample_rate)
  if (!Number.isSafeInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000) {
    throw new Error(`Unsupported sample rate: ${stream.sample_rate}`)
  }
  const duration = Number(stream.duration || data.format?.duration)
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('Input duration is unavailable or invalid')
  return { channels, sampleRate, duration, totalFrames: Math.ceil(duration * 30), codecName: stream.codec_name }
}

async function analyzeFrame(input, metadata, frameIndex, native, isCurrent = () => true, multiband = false) {
  if (!Number.isSafeInteger(frameIndex) || frameIndex < 0 || frameIndex >= metadata.totalFrames) {
    throw new Error('Preview frame is outside the song')
  }
  const target = Math.min(Math.floor((frameIndex + 1) * metadata.sampleRate / 30),
    Math.ceil(metadata.duration * metadata.sampleRate))
  const reader = new PcmReader(input, metadata.sampleRate)
  let processed = 0
  try {
    native.reset()
    native.setSampleRate(metadata.sampleRate)
    while (processed < target) {
      if (!isCurrent()) throw new Error('Preview superseded')
      const pcm = await reader.readFrames(Math.min(8192, target - processed))
      if (pcm.frames === 0) throw new Error(`Audio decoder ended at sample ${processed}, before preview frame ${frameIndex}`)
      native.pushSamples(pcm.left, pcm.right)
      if (multiband) native.pushMultibandSamples(pcm.left, pcm.right)
      processed += pcm.frames
    }
    if (!isCurrent()) throw new Error('Preview superseded')
    const result = native.getPoints(1024)
    const bands = multiband ? native.getMultibandPoints(1024) : null
    return {
      x: Buffer.from(result.x.buffer, result.x.byteOffset, result.count * 4).toString('base64'),
      y: Buffer.from(result.y.buffer, result.y.byteOffset, result.count * 4).toString('base64'),
      multiband: bands ? Buffer.from(bands.data.buffer, bands.data.byteOffset, bands.count * 6 * 4).toString('base64') : '',
      sampleRate: metadata.sampleRate, frameIndex, processedFrames: processed,
    }
  } finally {
    await reader.close()
  }
}

module.exports = { probeAudio, analyzeFrame }

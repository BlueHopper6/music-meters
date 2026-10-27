const fs = require('node:fs')
const path = require('node:path')
const { PcmReader } = require('../phase1/pcm-reader.cjs')

const FPS = 30
const NATIVE_BUFFER_SIZE = 32768
const WARMUP_SAMPLES = 4096

function displaySamples(sampleRate) {
  const samples = sampleRate < 44100 ? Math.round(2048 * sampleRate / 44100)
    : sampleRate > 48000 ? Math.round(2048 * sampleRate / 48000) : 2048
  return Math.max(64, Math.min(32767, samples))
}

function configurations(project) {
  const modes = new Set(project.layers.filter(layer => layer.type === 'oscilloscope')
    .map(layer => layer.pitchLock ? 'locked' : 'free'))
  return ['locked', 'free'].filter(mode => modes.has(mode))
}

function setup(native, sampleRate) {
  native.setSampleRate(sampleRate)
  native.setDisplaySamples(displaySamples(sampleRate))
  native.reset()
}

function capture(native, mode, consumed, count) {
  native.setPitchLock(mode === 'locked')
  const result = native.processContinuous()
  if (result.samplesToShow !== count) throw new Error('Prism oscilloscope returned an unexpected window size')
  const valid = mode === 'free' || consumed >= WARMUP_SAMPLES
  const values = new Float32Array(count)
  if (valid) {
    let start = mode === 'locked' ? result.triggerIndex : result.writePos - count
    while (start < 0) start += NATIVE_BUFFER_SIZE
    const filled = native.fillSamples(start, values)
    if (filled !== count) throw new Error('Prism oscilloscope returned an incomplete wave')
  }
  const bytes = Buffer.allocUnsafe(12 + count * 4)
  bytes.writeUInt32LE(valid ? 1 : 0, 0)
  bytes.writeFloatLE(result.detectedPitch, 4)
  bytes.writeFloatLE(result.triggerIndex, 8)
  Buffer.from(values.buffer).copy(bytes, 12)
  return bytes
}

function encoded(bytes) {
  return { samples: bytes.readUInt32LE(0) ? bytes.subarray(12).toString('base64') : '',
    detectedPitch: bytes.readFloatLE(4), triggerIndex: bytes.readFloatLE(8) }
}

async function analyze(input, metadata, project, native, lastFrame, isCurrent, onFrame, cancelledMessage) {
  const modes = configurations(project)
  if (!modes.length) return
  const reader = new PcmReader(input, metadata.sampleRate)
  const count = displaySamples(metadata.sampleRate)
  let consumed = 0
  try {
    setup(native, metadata.sampleRate)
    for (let index = 0; index <= lastFrame; index++) {
      if (!isCurrent()) throw new Error(cancelledMessage)
      const nextSample = Math.min(Math.floor((index + 1) * metadata.sampleRate / FPS),
        Math.ceil(metadata.duration * metadata.sampleRate))
      const pcm = await reader.readFrames(Math.max(0, nextSample - consumed))
      if (pcm.frames === 0 && index < lastFrame) throw new Error(`Audio decoder ended early at frame ${index}`)
      if (pcm.frames > 0) native.pushSamples(pcm.left)
      consumed += pcm.frames
      for (const mode of modes) onFrame(mode, index, capture(native, mode, consumed, count))
    }
  } finally { await reader.close() }
}

async function previewOscilloscopes(input, metadata, frameIndex, project, native, isCurrent = () => true) {
  const result = {}
  await analyze(input, metadata, project, native, frameIndex, isCurrent,
    (mode, index, bytes) => { if (index === frameIndex) result[mode] = encoded(bytes) }, 'Preview superseded')
  if (!isCurrent()) throw new Error('Preview superseded')
  return result
}

async function precomputeOscilloscopes(input, metadata, project, native, directory, isCurrent, onProgress) {
  const modes = configurations(project)
  if (!modes.length) return { frame: () => ({}), close: () => {} }
  fs.mkdirSync(directory, { recursive: true })
  const files = new Map()
  const writers = new Map()
  try {
    for (const mode of modes) writers.set(mode, fs.openSync(path.join(directory, `${mode}.bin`), 'w'))
    await analyze(input, metadata, project, native, metadata.totalFrames - 1, isCurrent,
      (mode, index, bytes) => {
        fs.writeSync(writers.get(mode), bytes)
        if (mode === modes.at(-1) && ((index + 1) % 30 === 0 || index + 1 === metadata.totalFrames)) {
          onProgress?.(index + 1, metadata.totalFrames)
        }
      }, 'Export cancelled')
    for (const writer of writers.values()) fs.closeSync(writer)
    writers.clear()
    for (const mode of modes) files.set(mode, fs.openSync(path.join(directory, `${mode}.bin`), 'r'))
    const recordBytes = 12 + displaySamples(metadata.sampleRate) * 4
    return {
      frame() {
        const result = {}
        for (const [mode, fd] of files) {
          const bytes = Buffer.allocUnsafe(recordBytes)
          if (fs.readSync(fd, bytes, 0, recordBytes, null) !== recordBytes) {
            throw new Error('Oscilloscope cache ended before video frames')
          }
          result[mode] = encoded(bytes)
        }
        return result
      },
      close() {
        for (const fd of files.values()) fs.closeSync(fd)
        files.clear()
        fs.rmSync(directory, { recursive: true, force: true })
      },
    }
  } catch (error) {
    for (const writer of writers.values()) fs.closeSync(writer)
    for (const fd of files.values()) fs.closeSync(fd)
    fs.rmSync(directory, { recursive: true, force: true })
    throw error
  }
}

module.exports = { displaySamples, configurations, setup, capture, encoded, previewOscilloscopes, precomputeOscilloscopes }

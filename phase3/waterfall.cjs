const fs = require('node:fs')
const path = require('node:path')
const { PcmReader } = require('../phase1/pcm-reader.cjs')

const FPS = 30
const MAX_RECORD = 8 + 64 * (512 + 1) * 4 + 512 * 4

function configuration(layer, scale, sampleRate) {
  const height = Math.max(1, Math.round(layer.h * scale))
  const width = Math.max(1, Math.round(layer.w * scale))
  const bottom = height - (layer.showGrid ? 22 : 10)
  const plotHeight = Math.max(1, bottom - 8)
  const historyHeight = plotHeight * 0.68
  const density = { sparse: 16, balanced: 32, dense: 64 }[layer.density]
  return { id: layer.id, ridges: Math.max(2, Math.min(density, Math.floor(historyHeight / 5) + 1)),
    columns: Math.max(2, Math.min(512, width)), options: {
      sampleRate, fftSize: layer.fftSize, historySeconds: layer.historySeconds,
      smoothing: layer.smoothing, tiltDbPerOctave: layer.tiltDbPerOctave,
      scaleMode: layer.scaleMode,
      minFrequency: layer.frequencyRangeMode === 'audible' ? 20 : 10,
      maxFrequency: Math.min(sampleRate / 2, layer.frequencyRangeMode === 'audible' ? 20000 : 24000),
    } }
}

function configurations(project, scale, sampleRate) {
  return project.layers.filter(layer => layer.type === 'waterfall' && layer.visible)
    .map(layer => configuration(layer, scale, sampleRate))
}

function pack(frame, expectedColumns) {
  const count = frame.ages.length
  if (frame.columns !== expectedColumns || count > 64 || frame.levels.length !== count * frame.columns
      || frame.frequencies.length !== frame.columns || !Number.isFinite(frame.audioSeconds)) {
    throw new Error('Prism waterfall returned an invalid frame')
  }
  const bytes = Buffer.allocUnsafe(8 + (count * (frame.columns + 1) + frame.columns) * 4)
  bytes.writeUInt32LE(count, 0)
  bytes.writeFloatLE(frame.audioSeconds, 4)
  let offset = 8
  for (const values of [frame.ages, frame.frequencies, frame.levels]) {
    Buffer.from(values.buffer, values.byteOffset, values.byteLength).copy(bytes, offset)
    offset += values.byteLength
  }
  return bytes
}

function unpack(bytes, columns) {
  const count = bytes.readUInt32LE(0)
  let offset = 8
  const take = length => {
    const result = bytes.subarray(offset, offset + length * 4).toString('base64')
    offset += length * 4
    return result
  }
  return { columns, audioSeconds: bytes.readFloatLE(4), ages: take(count),
    frequencies: take(columns), levels: take(count * columns) }
}

async function analyze(input, metadata, lastFrame, native, config, isCurrent, onFrame, cancelledMessage, everyFrame = true) {
  const reader = new PcmReader(input, metadata.sampleRate)
  let consumed = 0
  try {
    native.configure(config.options)
    native.reset()
    for (let index = 0; index <= lastFrame; index++) {
      if (!isCurrent()) throw new Error(cancelledMessage)
      const nextSample = Math.min(Math.floor((index + 1) * metadata.sampleRate / FPS),
        Math.ceil(metadata.duration * metadata.sampleRate))
      const pcm = await reader.readFrames(Math.max(0, nextSample - consumed))
      if (pcm.frames === 0 && index < lastFrame) throw new Error(`Audio decoder ended early at frame ${index}`)
      consumed += pcm.frames
      native.processStereo(pcm.left, pcm.right)
      if (everyFrame || index === lastFrame) onFrame(index, native.getFrame(config.ridges, config.columns))
    }
  } finally { await reader.close() }
}

async function previewWaterfalls(input, metadata, frameIndex, project, native, isCurrent = () => true) {
  const output = {}
  for (const config of configurations(project, 1, metadata.sampleRate)) {
    await analyze(input, metadata, frameIndex, native, config, isCurrent, (index, frame) => {
      if (index === frameIndex) output[config.id] = unpack(pack(frame, config.columns), config.columns)
    }, 'Preview superseded', false)
  }
  if (!isCurrent()) throw new Error('Preview superseded')
  return output
}

async function precomputeWaterfalls(input, metadata, project, native, directory, scale, isCurrent, onProgress) {
  const configs = configurations(project, scale, metadata.sampleRate)
  if (!configs.length) return { frame: () => ({}), close: () => {} }
  fs.mkdirSync(directory, { recursive: true })
  const files = new Map()
  try {
    for (const [configIndex, config] of configs.entries()) {
      const filename = path.join(directory, `waterfall-${configIndex}.bin`)
      const writer = fs.openSync(filename, 'w')
      try {
        await analyze(input, metadata, metadata.totalFrames - 1, native, config, isCurrent, (index, frame) => {
          fs.writeSync(writer, pack(frame, config.columns))
          if ((index + 1) % 30 === 0 || index + 1 === metadata.totalFrames) {
            onProgress?.(configIndex + 1, configs.length, index + 1, metadata.totalFrames)
          }
        }, 'Export cancelled')
      } finally { fs.closeSync(writer) }
      files.set(config.id, { fd: fs.openSync(filename, 'r'), columns: config.columns })
    }
    return {
      frame() {
        const output = {}
        for (const [id, file] of files) {
          const header = Buffer.allocUnsafe(8)
          if (fs.readSync(file.fd, header, 0, 8, null) !== 8) throw new Error('Waterfall cache ended before video frames')
          const count = header.readUInt32LE(0)
          if (count > 64) throw new Error('Waterfall cache has an invalid ridge count')
          const length = 8 + (count * (file.columns + 1) + file.columns) * 4
          if (length > MAX_RECORD) throw new Error('Waterfall cache frame is too large')
          const bytes = Buffer.allocUnsafe(length)
          header.copy(bytes)
          if (fs.readSync(file.fd, bytes, 8, length - 8, null) !== length - 8) {
            throw new Error('Waterfall cache has a truncated frame')
          }
          output[id] = unpack(bytes, file.columns)
        }
        return output
      },
      close() {
        for (const file of files.values()) fs.closeSync(file.fd)
        files.clear()
        fs.rmSync(directory, { recursive: true, force: true })
      },
    }
  } catch (error) {
    for (const file of files.values()) fs.closeSync(file.fd)
    fs.rmSync(directory, { recursive: true, force: true })
    throw error
  }
}

module.exports = { configuration, configurations, previewWaterfalls, precomputeWaterfalls }

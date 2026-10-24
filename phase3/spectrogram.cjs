const fs = require('node:fs')
const path = require('node:path')
const { PcmReader } = require('../phase1/pcm-reader.cjs')

const FPS = 30

function configuration(layer, scale, sampleRate) {
  return { fftSize: layer.fftSize, sampleRate,
    rowCount: Math.max(1, Math.round((layer.orientation === 'vertical' ? layer.w : layer.h) * scale)),
    minFrequency: layer.minFrequency, maxFrequency: layer.maxFrequency,
    minDecibels: layer.minDecibels, maxDecibels: layer.maxDecibels,
    scrollSpeed: layer.scrollSpeed, contrast: layer.contrast,
    tiltDbPerOctave: layer.tiltDbPerOctave, clarityMode: layer.clarityMode,
    scaleMode: layer.scaleMode, orientation: layer.orientation }
}

function configurations(project, scale, sampleRate) {
  return project.layers.filter(layer => layer.type === 'spectrogram' && layer.visible)
    .map(layer => ({ id: layer.id, span: Math.max(1, Math.round(
      (layer.orientation === 'vertical' ? layer.h : layer.w) * scale)),
      options: configuration(layer, scale, sampleRate) }))
}

function encode(result) {
  const count = result.columnCount * result.rowCount
  return { columnCount: result.columnCount, rowCount: result.rowCount,
    display: Buffer.from(result.display.buffer, result.display.byteOffset, count * 4).toString('base64'),
    heat: Buffer.from(result.heat.buffer, result.heat.byteOffset, count * 4).toString('base64') }
}

function pack(result, rowCount) {
  if (!result || result.rowCount !== rowCount || !Number.isSafeInteger(result.columnCount)
      || result.columnCount < 0 || result.display.length < result.columnCount * rowCount
      || result.heat.length < result.columnCount * rowCount) {
    throw new Error('Prism spectrogram returned invalid columns')
  }
  const count = result.columnCount * rowCount
  const bytes = Buffer.allocUnsafe(4 + count * 8)
  bytes.writeUInt32LE(result.columnCount, 0)
  Buffer.from(result.display.buffer, result.display.byteOffset, count * 4).copy(bytes, 4)
  Buffer.from(result.heat.buffer, result.heat.byteOffset, count * 4).copy(bytes, 4 + count * 4)
  return bytes
}

function unpack(bytes, rowCount) {
  const columnCount = bytes.readUInt32LE(0)
  const length = columnCount * rowCount * 4
  return { columnCount, rowCount,
    display: bytes.subarray(4, 4 + length).toString('base64'),
    heat: bytes.subarray(4 + length, 4 + length * 2).toString('base64') }
}

async function analyze(input, metadata, lastFrame, native, config, isCurrent, onFrame, cancelledMessage) {
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
      const columns = native.processStereo(pcm.left, pcm.right)
      onFrame(index, columns)
    }
  } finally { await reader.close() }
}

async function previewSpectrograms(input, metadata, frameIndex, project, native, isCurrent = () => true) {
  const output = {}
  for (const config of configurations(project, 1, metadata.sampleRate)) {
    const entries = []
    let totalColumns = 0
    await analyze(input, metadata, frameIndex, native, config, isCurrent, (_index, columns) => {
      const value = encode(columns)
      entries.push(value)
      totalColumns += value.columnCount
      while (entries.length > 1 && totalColumns - entries[0].columnCount >= config.span) {
        totalColumns -= entries.shift().columnCount
      }
    }, 'Preview superseded')
    output[config.id] = { rebuild: true, entries }
  }
  if (!isCurrent()) throw new Error('Preview superseded')
  return output
}

async function precomputeSpectrograms(input, metadata, project, native, directory, scale, isCurrent, onProgress) {
  const configs = configurations(project, scale, metadata.sampleRate)
  if (!configs.length) return { frame: () => ({}), close: () => {} }
  fs.mkdirSync(directory, { recursive: true })
  const files = new Map()
  try {
    for (const [configIndex, config] of configs.entries()) {
      const filename = path.join(directory, `spectrogram-${configIndex}.bin`)
      const writer = fs.openSync(filename, 'w')
      try {
        await analyze(input, metadata, metadata.totalFrames - 1, native, config, isCurrent, (index, columns) => {
          fs.writeSync(writer, pack(columns, config.options.rowCount))
          if ((index + 1) % 30 === 0 || index + 1 === metadata.totalFrames) {
            onProgress?.(configIndex + 1, configs.length, index + 1, metadata.totalFrames)
          }
        }, 'Export cancelled')
      } finally { fs.closeSync(writer) }
      files.set(config.id, { fd: fs.openSync(filename, 'r'), rowCount: config.options.rowCount })
    }
    return {
      frame() {
        const output = {}
        for (const [id, file] of files) {
          const header = Buffer.allocUnsafe(4)
          if (fs.readSync(file.fd, header, 0, 4, null) !== 4) throw new Error('Spectrogram cache ended before video frames')
          const columnCount = header.readUInt32LE(0)
          if (columnCount > 4096) throw new Error('Spectrogram cache has an invalid column count')
          const bytes = Buffer.allocUnsafe(4 + columnCount * file.rowCount * 8)
          header.copy(bytes)
          if (fs.readSync(file.fd, bytes, 4, bytes.length - 4, null) !== bytes.length - 4) {
            throw new Error('Spectrogram cache has a truncated frame')
          }
          output[id] = { rebuild: false, entries: [unpack(bytes, file.rowCount)] }
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

module.exports = { configuration, configurations, previewSpectrograms, precomputeSpectrograms }

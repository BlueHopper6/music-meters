const fs = require('node:fs')
const path = require('node:path')
const { PcmReader } = require('../phase1/pcm-reader.cjs')

const FPS = 30
const BASE_COLUMNS_PER_SECOND = 128 // Prism scopeMeasurement.ts

function configurations(project, sampleRate, scale = 1) {
  return project.layers.filter(layer => layer.type === 'waveform' && layer.visible).map(layer => ({
    id: layer.id, mode: layer.mode,
    span: Math.max(1, Math.round(layer.w * scale)),
    samplesPerColumn: Math.max(1, Math.round(sampleRate / (BASE_COLUMNS_PER_SECOND * layer.scrollSpeed))),
    stride: layer.mode === 'stereo' ? 10 : 5,
  }))
}

function validate(summary, stride) {
  if (!(summary instanceof Float32Array) || summary.length % stride !== 0) {
    throw new Error('Prism waveform returned invalid columns')
  }
  for (const value of summary) {
    if (!Number.isFinite(value)) throw new Error('Prism waveform returned a nonfinite column')
  }
  return summary
}

function encoded(summary) {
  return Buffer.from(summary.buffer, summary.byteOffset, summary.byteLength).toString('base64')
}

async function analyze(input, metadata, lastFrame, native, config, isCurrent, onFrame, cancelledMessage) {
  const reader = new PcmReader(input, metadata.sampleRate)
  let consumed = 0
  try {
    native.configure(metadata.sampleRate, config.samplesPerColumn)
    native.reset()
    for (let index = 0; index <= lastFrame; index++) {
      if (!isCurrent()) throw new Error(cancelledMessage)
      const nextSample = Math.min(Math.floor((index + 1) * metadata.sampleRate / FPS),
        Math.ceil(metadata.duration * metadata.sampleRate))
      const pcm = await reader.readFrames(Math.max(0, nextSample - consumed))
      if (pcm.frames === 0 && index < lastFrame) throw new Error(`Audio decoder ended early at frame ${index}`)
      consumed += pcm.frames
      const summary = config.mode === 'stereo'
        ? native.processStereo(pcm.left, pcm.right) : native.processMono(pcm.left)
      onFrame(index, validate(summary, config.stride))
    }
  } finally { await reader.close() }
}

async function previewWaveforms(input, metadata, frameIndex, project, native, isCurrent = () => true) {
  const output = {}
  for (const config of configurations(project, metadata.sampleRate)) {
    const entries = []
    let totalColumns = 0
    await analyze(input, metadata, frameIndex, native, config, isCurrent, (_index, summary) => {
      const columns = summary.length / config.stride
      entries.push({ columns, summary: encoded(summary) })
      totalColumns += columns
      while (entries.length > 1 && totalColumns - entries[0].columns >= config.span) {
        totalColumns -= entries.shift().columns
      }
    }, 'Preview superseded')
    output[config.id] = { rebuild: true, entries }
  }
  if (!isCurrent()) throw new Error('Preview superseded')
  return output
}

async function precomputeWaveforms(input, metadata, project, native, directory, scale, isCurrent, onProgress) {
  const configs = configurations(project, metadata.sampleRate, scale)
  if (!configs.length) return { frame: () => ({}), close: () => {} }
  fs.mkdirSync(directory, { recursive: true })
  const files = new Map()
  try {
    for (const [configIndex, config] of configs.entries()) {
      const filename = path.join(directory, `waveform-${configIndex}.bin`)
      const writer = fs.openSync(filename, 'w')
      try {
        await analyze(input, metadata, metadata.totalFrames - 1, native, config, isCurrent, (index, summary) => {
          const header = Buffer.allocUnsafe(4)
          header.writeUInt32LE(summary.length, 0)
          fs.writeSync(writer, header)
          fs.writeSync(writer, Buffer.from(summary.buffer, summary.byteOffset, summary.byteLength))
          if ((index + 1) % 30 === 0 || index + 1 === metadata.totalFrames) {
            onProgress?.(configIndex + 1, configs.length, index + 1, metadata.totalFrames)
          }
        }, 'Export cancelled')
      } finally { fs.closeSync(writer) }
      files.set(config.id, { fd: fs.openSync(filename, 'r'), stride: config.stride })
    }
    return {
      frame() {
        const output = {}
        for (const [id, file] of files) {
          const header = Buffer.allocUnsafe(4)
          if (fs.readSync(file.fd, header, 0, 4, null) !== 4) throw new Error('Waveform cache ended before video frames')
          const count = header.readUInt32LE(0)
          if (count % file.stride || count > 4096) throw new Error('Waveform cache has an invalid column count')
          const bytes = Buffer.allocUnsafe(count * 4)
          if (fs.readSync(file.fd, bytes, 0, bytes.length, null) !== bytes.length) {
            throw new Error('Waveform cache has a truncated frame')
          }
          output[id] = { rebuild: false, entries: [{ columns: count / file.stride, summary: bytes.toString('base64') }] }
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

module.exports = { configurations, previewWaveforms, precomputeWaveforms }

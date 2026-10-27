const fs = require('node:fs')
const path = require('node:path')
const { PcmReader } = require('../phase1/pcm-reader.cjs')

const FPS = 30

function keyFor(layer) { return `${layer.fftSize}:${layer.smoothing}` }

function configurations(project) {
  const unique = new Map()
  for (const layer of project.layers) {
    if (layer.type === 'spectrum') unique.set(keyFor(layer),
      { key: keyFor(layer), fftSize: layer.fftSize, smoothing: layer.smoothing })
  }
  return [...unique.values()]
}

function setup(native, config, sampleRate) {
  native.setReferenceEnabled(false)
  native.setFFTSize(config.fftSize)
  native.setSampleRate(sampleRate)
  // Prism's Canvas painter applies this FFT-size adjustment before configuring its native analyzer.
  native.setSmoothing(Math.pow(config.smoothing, Math.max(0.5, config.fftSize / 2048)))
  native.reset()
}

function capture(native, bins) {
  const mid = native.getMagnitudes()
  const side = native.getSideMagnitudes()
  if (mid.length !== bins || side.length !== bins) throw new Error('Prism spectrum returned an unexpected FFT length')
  const bytes = Buffer.allocUnsafe(bins * 8)
  Buffer.from(mid.buffer, mid.byteOffset, mid.byteLength).copy(bytes, 0)
  Buffer.from(side.buffer, side.byteOffset, side.byteLength).copy(bytes, bins * 4)
  return bytes
}

function encoded(bytes, bins) {
  return { mid: bytes.subarray(0, bins * 4).toString('base64'),
    side: bytes.subarray(bins * 4).toString('base64') }
}

async function advance(reader, native, sampleRate, duration, index, consumed) {
  const nextSample = Math.min(Math.floor((index + 1) * sampleRate / FPS),
    Math.ceil(duration * sampleRate))
  const pcm = await reader.readFrames(Math.max(0, nextSample - consumed))
  if (pcm.frames === 0 && index < Math.ceil(duration * FPS) - 1) {
    throw new Error(`Audio decoder ended early at frame ${index}`)
  }
  if (pcm.frames > 0) native.pushStereoSamples(pcm.left, pcm.right)
  return consumed + pcm.frames
}

async function previewSpectra(input, metadata, frameIndex, project, native, isCurrent = () => true) {
  const result = {}
  for (const config of configurations(project)) {
    if (!isCurrent()) throw new Error('Preview superseded')
    const reader = new PcmReader(input, metadata.sampleRate)
    let consumed = 0
    try {
      setup(native, config, metadata.sampleRate)
      for (let index = 0; index <= frameIndex; index++) {
        if (!isCurrent()) throw new Error('Preview superseded')
        consumed = await advance(reader, native, metadata.sampleRate, metadata.duration, index, consumed)
      }
      result[config.key] = encoded(capture(native, config.fftSize / 2), config.fftSize / 2)
    } finally { await reader.close() }
  }
  return result
}

async function precomputeSpectra(input, metadata, project, native, directory, isCurrent, onProgress) {
  const configs = configurations(project)
  if (configs.length === 0) return { frame: () => ({}), close: () => {} }
  fs.mkdirSync(directory, { recursive: true })
  const files = new Map()
  try {
    for (const [configIndex, config] of configs.entries()) {
      if (!isCurrent()) throw new Error('Export cancelled')
      const filename = path.join(directory, `spectrum-${configIndex}.bin`)
      const writer = fs.openSync(filename, 'w')
      const reader = new PcmReader(input, metadata.sampleRate)
      let consumed = 0
      try {
        setup(native, config, metadata.sampleRate)
        for (let index = 0; index < metadata.totalFrames; index++) {
          if (!isCurrent()) throw new Error('Export cancelled')
          consumed = await advance(reader, native, metadata.sampleRate, metadata.duration, index, consumed)
          const bytes = capture(native, config.fftSize / 2)
          fs.writeSync(writer, bytes)
          if ((index + 1) % 30 === 0 || index + 1 === metadata.totalFrames) {
            onProgress?.(configIndex + 1, configs.length, index + 1, metadata.totalFrames)
          }
        }
      } finally { fs.closeSync(writer); await reader.close() }
      files.set(config.key, { fd: fs.openSync(filename, 'r'), bins: config.fftSize / 2 })
    }
    return {
      frame() {
        const data = {}
        for (const [key, file] of files) {
          const bytes = Buffer.allocUnsafe(file.bins * 8)
          const read = fs.readSync(file.fd, bytes, 0, bytes.length, null)
          if (read !== bytes.length) throw new Error('Spectrum cache ended before video frames')
          data[key] = encoded(bytes, file.bins)
        }
        return data
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

module.exports = { keyFor, configurations, setup, capture, encoded, previewSpectra, precomputeSpectra }

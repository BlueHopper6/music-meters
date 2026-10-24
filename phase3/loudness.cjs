const fs = require('node:fs')
const path = require('node:path')
const { PcmReader } = require('../phase1/pcm-reader.cjs')
const { TruePeak } = require('./true-peak.cjs')

const FPS = 30
const FIELDS = ['momentaryLUFS', 'shortTermLUFS', 'integratedLUFS', 'vuLDb', 'vuRDb',
  'barLDb', 'barRDb', 'truePeakLDb', 'truePeakRDb', 'maxTruePeakDb', 'correlation']

function activeIds(project) {
  return project.layers.filter(layer => layer.type === 'loudness' && layer.visible).map(layer => layer.id)
}

function encode(values) {
  return Buffer.from(values.buffer, values.byteOffset, values.byteLength).toString('base64')
}

async function analyze(input, metadata, lastFrame, native, isCurrent, onFrame, cancelledMessage) {
  const reader = new PcmReader(input, metadata.sampleRate)
  const peak = new TruePeak(metadata.sampleRate)
  let consumed = 0
  try {
    native.setSampleRate(metadata.sampleRate)
    native.reset()
    for (let index = 0; index <= lastFrame; index++) {
      if (!isCurrent()) throw new Error(cancelledMessage)
      const nextSample = Math.min(Math.floor((index + 1) * metadata.sampleRate / FPS),
        Math.ceil(metadata.duration * metadata.sampleRate))
      const pcm = await reader.readFrames(Math.max(0, nextSample - consumed))
      if (!pcm.frames && index < lastFrame) throw new Error(`Audio decoder ended early at frame ${index}`)
      consumed += pcm.frames
      if (pcm.frames) native.pushSamples(pcm.left, pcm.right)
      const nativeSnapshot = native.getSnapshot()
      if (!nativeSnapshot) throw new Error('Prism native loudness analyzer is unavailable')
      const peakSnapshot = peak.process(pcm.left, pcm.right, index * 1000 / FPS)
      const snapshot = { ...nativeSnapshot,
        truePeakLDb: peakSnapshot.truePeakLDb, truePeakRDb: peakSnapshot.truePeakRDb }
      const values = new Float32Array(FIELDS.map(field => snapshot[field]))
      if ([...values].some(value => !Number.isFinite(value))) {
        throw new Error('Prism loudness analyzer returned a nonfinite reading')
      }
      onFrame(index, values, nativeSnapshot, peakSnapshot)
    }
    if (!isCurrent()) throw new Error(cancelledMessage)
  } finally { await reader.close() }
}

async function previewLoudness(input, metadata, frameIndex, project, native, isCurrent = () => true) {
  const ids = activeIds(project)
  if (!ids.length) return {}
  let current
  await analyze(input, metadata, frameIndex, native, isCurrent,
    (_index, values) => { current = values }, 'Preview superseded')
  const encoded = encode(current)
  return Object.fromEntries(ids.map(id => [id, encoded]))
}

async function precomputeLoudness(input, metadata, project, native, directory, isCurrent, onProgress) {
  const ids = activeIds(project)
  if (!ids.length) return { frame: () => ({}), close: () => {} }
  fs.mkdirSync(directory, { recursive: true })
  const filename = path.join(directory, 'loudness.bin')
  let readerFd
  try {
    const writer = fs.openSync(filename, 'w')
    try {
      await analyze(input, metadata, metadata.totalFrames - 1, native, isCurrent,
        (index, values) => {
          fs.writeSync(writer, Buffer.from(values.buffer, values.byteOffset, values.byteLength))
          if ((index + 1) % FPS === 0 || index + 1 === metadata.totalFrames) {
            onProgress?.(index + 1, metadata.totalFrames)
          }
        }, 'Export cancelled')
    } finally { fs.closeSync(writer) }
    readerFd = fs.openSync(filename, 'r')
    return {
      frame() {
        const bytes = Buffer.allocUnsafe(FIELDS.length * 4)
        if (fs.readSync(readerFd, bytes, 0, bytes.length, null) !== bytes.length) {
          throw new Error('Loudness cache ended before video frames')
        }
        const encoded = bytes.toString('base64')
        return Object.fromEntries(ids.map(id => [id, encoded]))
      },
      close() {
        fs.closeSync(readerFd)
        readerFd = null
        fs.rmSync(directory, { recursive: true, force: true })
      },
    }
  } catch (error) {
    if (readerFd !== undefined && readerFd !== null) fs.closeSync(readerFd)
    fs.rmSync(directory, { recursive: true, force: true })
    throw error
  }
}

module.exports = { FIELDS, activeIds, analyze, previewLoudness, precomputeLoudness }

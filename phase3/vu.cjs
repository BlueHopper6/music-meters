const fs = require('node:fs')
const path = require('node:path')
const { PcmReader } = require('../phase1/pcm-reader.cjs')
const { VUMeterBallistics } = require('../artifacts/phase2/vu-ballistics.cjs')

const FPS = 30
const FIELDS = ['vuLDb', 'vuRDb', 'barLDb', 'barRDb', 'peakLDb', 'peakRDb', 'correlation']
// Prism's needle display peak falls at 12 dB/s; six seconds clears even a 0 dB peak.
const PREVIEW_PREROLL_FRAMES = 6 * FPS + 1

function activeIds(project) {
  return project.layers.filter(layer => layer.type === 'vu' && layer.visible).map(layer => layer.id)
}

function values(nativeSnapshot, ballisticsSnapshot) {
  // Native RMS, fast bar, and correlation are sample-driven. Its peak hold uses
  // steady_clock, so take only peak fields from Prism's deterministic JS ballistics.
  const snapshot = { ...nativeSnapshot,
    peakLDb: ballisticsSnapshot.peakLDb, peakRDb: ballisticsSnapshot.peakRDb }
  const output = new Float32Array(FIELDS.map(field => snapshot[field]))
  if ([...output].some(value => !Number.isFinite(value))) throw new Error('Prism VU returned a nonfinite reading')
  return output
}

function encode(flat) {
  return Buffer.from(flat.buffer, flat.byteOffset, flat.byteLength).toString('base64')
}

async function analyze(input, metadata, lastFrame, native, isCurrent, onFrame, cancelledMessage) {
  const reader = new PcmReader(input, metadata.sampleRate)
  const ballistics = new VUMeterBallistics(metadata.sampleRate)
  let consumed = 0
  try {
    native.setSampleRate(metadata.sampleRate)
    native.reset()
    for (let index = 0; index <= lastFrame; index++) {
      if (!isCurrent()) throw new Error(cancelledMessage)
      const nextSample = Math.min(Math.floor((index + 1) * metadata.sampleRate / FPS),
        Math.ceil(metadata.duration * metadata.sampleRate))
      const pcm = await reader.readFrames(Math.max(0, nextSample - consumed))
      if (pcm.frames === 0 && index < lastFrame) throw new Error(`Audio decoder ended early at frame ${index}`)
      consumed += pcm.frames
      const chunks = pcm.frames ? [{ left: pcm.left, right: pcm.right }] : []
      if (pcm.frames) native.pushSamples(pcm.left, pcm.right)
      const jsSnapshot = ballistics.process(chunks, index * 1000 / FPS)
      const nativeSnapshot = native.getSnapshot()
      if (!nativeSnapshot) throw new Error('Prism native VU analyzer is unavailable')
      onFrame(index, values(nativeSnapshot, jsSnapshot), nativeSnapshot, jsSnapshot)
    }
  } finally { await reader.close() }
}

async function previewVus(input, metadata, frameIndex, project, native, isCurrent = () => true) {
  const ids = activeIds(project)
  if (!ids.length) return {}
  const history = []
  await analyze(input, metadata, frameIndex, native, isCurrent, (_index, snapshot) => {
    history.push(snapshot)
    if (history.length > PREVIEW_PREROLL_FRAMES) history.shift()
  }, 'Preview superseded')
  if (!isCurrent()) throw new Error('Preview superseded')
  const flat = new Float32Array(history.length * FIELDS.length)
  history.forEach((snapshot, index) => flat.set(snapshot, index * FIELDS.length))
  const frame = { rebuild: true, startFrame: frameIndex - history.length + 1, values: encode(flat) }
  return Object.fromEntries(ids.map(id => [id, frame]))
}

async function precomputeVus(input, metadata, project, native, directory, isCurrent, onProgress) {
  const ids = activeIds(project)
  if (!ids.length) return { frame: () => ({}), close: () => {} }
  fs.mkdirSync(directory, { recursive: true })
  const filename = path.join(directory, 'vu.bin')
  let readerFd
  try {
    const writer = fs.openSync(filename, 'w')
    try {
      await analyze(input, metadata, metadata.totalFrames - 1, native, isCurrent, (index, snapshot) => {
        fs.writeSync(writer, Buffer.from(snapshot.buffer, snapshot.byteOffset, snapshot.byteLength))
        if ((index + 1) % 30 === 0 || index + 1 === metadata.totalFrames) {
          onProgress?.(index + 1, metadata.totalFrames)
        }
      }, 'Export cancelled')
    } finally { fs.closeSync(writer) }
    readerFd = fs.openSync(filename, 'r')
    let index = 0
    return {
      frame() {
        const bytes = Buffer.allocUnsafe(FIELDS.length * 4)
        if (fs.readSync(readerFd, bytes, 0, bytes.length, null) !== bytes.length) {
          throw new Error('VU cache ended before video frames')
        }
        const frame = { rebuild: false, startFrame: index++, values: bytes.toString('base64') }
        return Object.fromEntries(ids.map(id => [id, frame]))
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

module.exports = { FIELDS, values, encode, PREVIEW_PREROLL_FRAMES, activeIds, analyze, previewVus, precomputeVus }

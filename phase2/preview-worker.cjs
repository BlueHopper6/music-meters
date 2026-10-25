const { parentPort } = require('node:worker_threads')
const { join, resolve } = require('node:path')
const { analyzeFrame } = require('./audio.cjs')
const spectrum = require('../phase3/spectrum.cjs')
const oscilloscope = require('../phase3/oscilloscope.cjs')
const spectrogram = require('../phase3/spectrogram.cjs')
const waveform = require('../phase3/waveform.cjs')
const vu = require('../phase3/vu.cjs')
const loudness = require('../phase3/loudness.cjs')
const waterfall = require('../phase3/waterfall.cjs')

const native = require(join(resolve(__dirname, '..'), 'upstream', 'prism', 'native', 'build', 'Release', 'visualizer_dsp.node'))
const cache = new Map()
const MAX_CACHE_ENTRIES = 16
let latestRequest = 0
let queue = Promise.resolve()

async function cached(key, isCurrent, compute) {
  if (!isCurrent()) throw new Error('Preview superseded')
  if (cache.has(key)) {
    const value = cache.get(key)
    cache.delete(key)
    cache.set(key, value)
    return value
  }
  const value = await compute()
  if (!isCurrent()) throw new Error('Preview superseded')
  cache.set(key, value)
  if (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value)
  return value
}

async function preview(message) {
  const { id, input, metadata, frame, project, audioRevision } = message
  const isCurrent = () => id === latestRequest
  const key = (family, configuration) => JSON.stringify([audioRevision, input, metadata.sampleRate,
    metadata.duration, frame, family, configuration])
  const hasVectorscope = project.layers.some(layer => layer.type === 'vectorscope' && layer.visible)
  const multiband = project.layers.some(layer => layer.type === 'vectorscope' && layer.visible && layer.multiband)
  const vectorscope = hasVectorscope
    ? await cached(key('vectorscope', multiband), isCurrent,
      () => analyzeFrame(input, metadata, frame, native.vectorscope, isCurrent, multiband))
    : { x: '', y: '', multiband: '', sampleRate: metadata.sampleRate, frameIndex: frame }
  const spectra = await cached(key('spectrum', spectrum.configurations(project)), isCurrent,
    () => spectrum.previewSpectra(input, metadata, frame, project, native.spectrum, isCurrent))
  const oscilloscopes = await cached(key('oscilloscope', oscilloscope.configurations(project)), isCurrent,
    () => oscilloscope.previewOscilloscopes(input, metadata, frame, project, native.oscilloscope, isCurrent))
  const spectrograms = await cached(key('spectrogram', spectrogram.configurations(project, 1, metadata.sampleRate)), isCurrent,
    () => spectrogram.previewSpectrograms(input, metadata, frame, project, native.spectrogram, isCurrent))
  const waveforms = await cached(key('waveform', waveform.configurations(project, metadata.sampleRate)), isCurrent,
    () => waveform.previewWaveforms(input, metadata, frame, project, native.waveform, isCurrent))
  const vus = await cached(key('vu', vu.activeIds(project)), isCurrent,
    () => vu.previewVus(input, metadata, frame, project, native.vumeter, isCurrent))
  const loudnessValues = await cached(key('loudness', loudness.activeIds(project)), isCurrent,
    () => loudness.previewLoudness(input, metadata, frame, project, native.lufsmeter, isCurrent))
  const waterfalls = await cached(key('waterfall', waterfall.configurations(project, 1, metadata.sampleRate)), isCurrent,
    () => waterfall.previewWaterfalls(input, metadata, frame, project, native.waterfall, isCurrent))
  if (!isCurrent()) throw new Error('Preview superseded')
  return { ...vectorscope, spectra, oscilloscopes, spectrograms, waveforms, vus,
    loudness: loudnessValues, waterfalls }
}

parentPort.on('message', message => {
  latestRequest = message.id
  if (message.type === 'cancel') return
  queue = queue.catch(() => {}).then(async () => {
    try {
      const result = await preview(message)
      parentPort.postMessage({ id: message.id, result })
    } catch (error) {
      parentPort.postMessage({ id: message.id,
        result: error.message === 'Preview superseded' ? { superseded: true } : null,
        error: error.message === 'Preview superseded' ? null : String(error) })
    }
  })
})

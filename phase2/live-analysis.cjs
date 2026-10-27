const path = require('node:path')
const { PcmReader } = require('../phase1/pcm-reader.cjs')
const spectrum = require('../phase3/spectrum.cjs')
const oscilloscope = require('../phase3/oscilloscope.cjs')
const spectrogram = require('../phase3/spectrogram.cjs')
const waveform = require('../phase3/waveform.cjs')
const vu = require('../phase3/vu.cjs')
const loudness = require('../phase3/loudness.cjs')
const waterfall = require('../phase3/waterfall.cjs')
const { TruePeak } = require('../phase3/true-peak.cjs')
const { VUMeterBallistics } = require('../artifacts/phase2/vu-ballistics.cjs')
const encode = array => Buffer.from(array.buffer, array.byteOffset, array.byteLength).toString('base64')

function layerKey(layer, rate) {
  if (layer.type === 'spectrum') return spectrum.keyFor(layer)
  if (layer.type === 'oscilloscope') return String(layer.pitchLock)
  if (layer.type === 'spectrogram') return JSON.stringify(spectrogram.configuration(layer, 1, rate))
  if (layer.type === 'waveform') return JSON.stringify([layer.mode, layer.scrollSpeed])
  if (layer.type === 'waterfall') { const { id, ...config } = waterfall.configuration(layer, 1, rate); return JSON.stringify(config) }
  return layer.type
}

// Prism exposes process-global analyzer instances. Independent configurations
// must run in separate processes, not threads sharing those native globals.
function analysisLanes(project, rate) {
  const families = new Map()
  for (const layer of project.layers) {
    if (!layer.visible || ['text', 'image'].includes(layer.type)) continue
    if (!families.has(layer.type)) families.set(layer.type, new Map())
    const groups = families.get(layer.type), key = layerKey(layer, rate)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(layer)
  }
  const lanes = []
  for (const groups of families.values()) [...groups.values()].forEach((layers, index) => {
    if (!lanes[index]) lanes[index] = []
    lanes[index].push(...layers)
  })
  return lanes.length ? lanes : [[]]
}

class LiveAnalysis {
  constructor(input, metadata, layers, frame) {
    this.metadata = metadata; this.layers = layers; this.index = Math.max(0, frame - 15)
    this.start = this.index; this.first = frame; this.consumed = 0
    this.reader = new PcmReader(input, metadata.sampleRate, 'ffmpeg', this.start / 30)
    this.native = require(path.join(__dirname, '../upstream/prism/native/build/Release/visualizer_dsp.node'))
    const n = this.native, rate = metadata.sampleRate
    const first = type => layers.find(layer => layer.type === type)
    this.scope = first('vectorscope'); this.multiband = layers.some(layer => layer.type === 'vectorscope' && layer.multiband)
    if (this.scope) { n.vectorscope.reset(); n.vectorscope.setSampleRate(rate) }
    this.spectrum = first('spectrum')
    if (this.spectrum) spectrum.setup(n.spectrum, this.spectrum, rate)
    this.osc = first('oscilloscope')
    if (this.osc) oscilloscope.setup(n.oscilloscope, rate)
    this.spec = first('spectrogram')
    if (this.spec) { n.spectrogram.configure(spectrogram.configuration(this.spec, 1, rate)); n.spectrogram.reset() }
    this.wave = first('waveform')
    if (this.wave) { this.waveConfig = waveform.configurations({ layers: [this.wave] }, rate)[0]; n.waveform.configure(rate, this.waveConfig.samplesPerColumn); n.waveform.reset() }
    this.vu = first('vu')
    if (this.vu) { n.vumeter.setSampleRate(rate); n.vumeter.reset(); this.ballistics = new VUMeterBallistics(rate) }
    this.loud = first('loudness')
    if (this.loud) { n.lufsmeter.setSampleRate(rate); n.lufsmeter.reset(); this.peak = new TruePeak(rate) }
    this.water = first('waterfall')
    if (this.water) { this.waterConfig = waterfall.configuration(this.water, 1, rate); n.waterfall.configure(this.waterConfig.options); n.waterfall.reset() }
  }
  async frame() {
    const index = this.index++, rate = this.metadata.sampleRate
    const target = Math.min(Math.floor((index + 1) * rate / 30), Math.ceil(this.metadata.duration * rate)) - Math.floor(this.start * rate / 30)
    const pcm = await this.reader.readFrames(Math.max(0, target - this.consumed))
    if (!pcm.frames) throw new Error('Live audio decoder ended early')
    this.consumed += pcm.frames
    const n = this.native, rebuilt = index === this.first
    const result = { frameIndex: index, sampleRate: rate, x: '', y: '', multiband: '', spectra: {}, oscilloscopes: {}, spectrograms: {}, waveforms: {}, vus: {}, loudness: {}, waterfalls: {} }
    if (this.scope) {
      n.vectorscope.pushSamples(pcm.left, pcm.right)
      if (this.multiband) n.vectorscope.pushMultibandSamples(pcm.left, pcm.right)
      const points = n.vectorscope.getPoints(1024)
      result.x = encode(points.x.subarray(0, points.count)); result.y = encode(points.y.subarray(0, points.count))
      if (this.multiband) { const bands = n.vectorscope.getMultibandPoints(1024); result.multiband = encode(bands.data.subarray(0, bands.count * 6)) }
    }
    if (this.spectrum) {
      n.spectrum.pushStereoSamples(pcm.left, pcm.right)
      result.spectra[spectrum.keyFor(this.spectrum)] = spectrum.encoded(spectrum.capture(n.spectrum, this.spectrum.fftSize / 2), this.spectrum.fftSize / 2)
    }
    if (this.osc) {
      n.oscilloscope.pushSamples(pcm.left)
      result.oscilloscopes[this.osc.pitchLock ? 'locked' : 'free'] = oscilloscope.encoded(oscilloscope.capture(n.oscilloscope,
        this.osc.pitchLock ? 'locked' : 'free', this.consumed, oscilloscope.displaySamples(rate)))
    }
    let spec, wave, vuFrame, loud, water
    if (this.spec) spec = { rebuild: rebuilt, entries: [spectrogram.encode(n.spectrogram.processStereo(pcm.left, pcm.right))] }
    if (this.wave) {
      const values = this.wave.mode === 'stereo' ? n.waveform.processStereo(pcm.left, pcm.right) : n.waveform.processMono(pcm.left)
      wave = { rebuild: rebuilt, entries: [{ columns: values.length / this.waveConfig.stride, summary: encode(values) }] }
    }
    if (this.vu) {
      n.vumeter.pushSamples(pcm.left, pcm.right)
      const ballistic = this.ballistics.process([{ left: pcm.left, right: pcm.right }], index * 1000 / 30)
      vuFrame = { rebuild: rebuilt, startFrame: index, values: vu.encode(vu.values(n.vumeter.getSnapshot(), ballistic)) }
    }
    if (this.loud) {
      n.lufsmeter.pushSamples(pcm.left, pcm.right)
      const peak = this.peak.process(pcm.left, pcm.right, index * 1000 / 30)
      const snapshot = { ...n.lufsmeter.getSnapshot(), truePeakLDb: peak.truePeakLDb, truePeakRDb: peak.truePeakRDb }
      const values = new Float32Array(loudness.FIELDS.map(field => snapshot[field]))
      if ([...values].some(value => !Number.isFinite(value))) throw new Error('Invalid live loudness snapshot')
      loud = encode(values)
    }
    if (this.water) {
      n.waterfall.processStereo(pcm.left, pcm.right)
      water = waterfall.unpack(waterfall.pack(n.waterfall.getFrame(this.waterConfig.ridges, this.waterConfig.columns), this.waterConfig.columns), this.waterConfig.columns)
    }
    for (const layer of this.layers) {
      if (layer.type === 'spectrogram') result.spectrograms[layer.id] = spec
      if (layer.type === 'waveform') result.waveforms[layer.id] = wave
      if (layer.type === 'vu') result.vus[layer.id] = vuFrame
      if (layer.type === 'loudness') result.loudness[layer.id] = loud
      if (layer.type === 'waterfall') result.waterfalls[layer.id] = water
    }
    return result
  }
  async pull(count) {
    while (this.index < this.first) await this.frame()
    const frames = []
    for (let i = 0; i < count && this.index < this.metadata.totalFrames; i++) frames.push(await this.frame())
    return frames
  }
  close() { return this.reader.close() }
}
module.exports = { LiveAnalysis, analysisLanes }

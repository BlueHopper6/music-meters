const fs = require('node:fs')
const path = require('node:path')
const { execFileSync, spawn } = require('node:child_process')
const { randomUUID } = require('node:crypto')
const { normalizeMixer, localVideoPath } = require('./project.cjs')
const { exportRange } = require('./export-range.cjs')
const { probeAudio } = require('./audio.cjs')
const { projectAudioReference, resolveProjectAudio } = require('./project-audio.cjs')
const { ffmpegExecutable, ffprobeExecutable, missingFfmpegMessage } = require('./ffmpeg.cjs')

const videoOf = project => project.layers.find(layer => layer.type === 'video')
function isDarwinSystemAlias(targetPath, platform = process.platform) {
  return platform === 'darwin' && (targetPath === '/var' || targetPath === '/tmp' || targetPath === '/etc')
}
function assertCachePath(root, input) {
  const relative = path.relative(root, input)
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Cache path escaped its session directory')
  if (process.platform === 'win32' && fs.existsSync(root) && fs.realpathSync(root).toLowerCase() !== path.resolve(root).toLowerCase()) {
    throw new Error('Cache directory follows a link or junction')
  }
  let current = input
  for (;;) {
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error('Cache paths must not follow links')
    if (current === root) break
    const parent = path.dirname(current)
    if (parent === current) throw new Error('Invalid cache directory')
    current = parent
  }
  for (let ancestor = path.resolve(root); ;) {
    if (fs.existsSync(ancestor) && !isDarwinSystemAlias(ancestor) && fs.lstatSync(ancestor).isSymbolicLink()) {
      throw new Error('Cache directory follows a link or junction')
    }
    const parent = path.dirname(ancestor)
    if (parent === ancestor) break
    ancestor = parent
  }
}
function saveVideoReferences(project, target) {
  return { ...project, layers: project.layers.map(layer => layer.type === 'video'
    ? { ...layer, videoPath: undefined, videoRelativePath: projectAudioReference(target, layer.videoPath) } : layer) }
}
function resolveVideoReferences(project, source) {
  return { ...project, layers: project.layers?.map(layer => layer.type === 'video'
    ? { ...layer, videoPath: resolveProjectAudio(source, layer.videoRelativePath) } : layer) }
}
function probeVideo(input) {
  localVideoPath(input)
  if (!path.isAbsolute(input) || !fs.statSync(input).isFile()) throw new Error('Choose a local video file')
  let raw
  try {
    raw = execFileSync(ffprobeExecutable(), ['-v', 'error', '-protocol_whitelist', 'file,pipe',
      '-show_streams', '-show_format', '-of', 'json', input], { encoding: 'utf8', maxBuffer: 1024 * 1024, windowsHide: true })
  } catch (error) {
    if (error && error.code === 'ENOENT') throw new Error(missingFfmpegMessage('FFprobe'))
    throw error
  }
  const data = JSON.parse(raw), stream = data.streams?.find(s => s.codec_type === 'video' && !s.disposition?.attached_pic)
  if (!stream) throw new Error('This file has no video stream')
  if (['smpte2084', 'arib-std-b67'].includes(stream.color_transfer)) throw new Error('HDR video is not supported yet. Convert to SDR BT.709 before importing.')
  const tagged = /^(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/.exec(stream.tags?.DURATION || stream.tags?.duration || '')
  const taggedDuration = tagged ? Number(tagged[1]) * 3600 + Number(tagged[2]) * 60 + Number(tagged[3]) - (Number(stream.start_time) || 0) : 0
  const sourceDuration = Number(stream.duration) || taggedDuration || Number(data.format?.duration)
  if (!Number.isFinite(sourceDuration) || sourceDuration <= 0 || sourceDuration > 24 * 60 * 60) throw new Error('Video duration must be between zero and 24 hours')
  // The composition/proxy use whole 30 FPS frames. Container duration can be
  // longer than the picture when its audio stream ends later (notably MKV).
  const duration = Math.ceil(sourceDuration * 30 - 1e-7) / 30
  if (!(stream.width > 0 && stream.height > 0) || stream.width > 8192 || stream.height > 8192) throw new Error('Unsupported video dimensions')
  const audioStream = data.streams?.find(s => s.codec_type === 'audio')
  const audio = audioStream ? probeAudio(input) : null
  const audioOffset = (Number(audioStream?.start_time) || 0) - (Number(stream.start_time) || 0)
  return { duration, width: stream.width, height: stream.height, audio, audioOffset, streamIndex: stream.index }
}
function mediaPlan(project) {
  const video = videoOf(project)
  const videoInfo = video?.videoPath ? probeVideo(video.videoPath) : null
  const audioInfo = project.audioPath ? probeAudio(project.audioPath) : null
  if (!videoInfo && !audioInfo) return null
  const mixer = normalizeMixer(project.mixer)
  if (mixer.durationMode === 'video' && !videoInfo) throw new Error('Choose a video before using video length')
  if (mixer.durationMode === 'audio' && !audioInfo) throw new Error('Import audio before using audio length')
  const duration = mixer.durationMode === 'video' ? videoInfo.duration
    : mixer.durationMode === 'audio' ? audioInfo.duration : Math.max(videoInfo?.duration || 0,
      videoInfo?.audio ? videoInfo.audio.duration + videoInfo.audioOffset : 0, audioInfo?.duration || 0)
  const sampleRate = Math.max(audioInfo?.sampleRate || 0, videoInfo?.audio?.sampleRate || 0) || 48000
  const channels = Math.max(audioInfo?.channels || 0, videoInfo?.audio?.channels || 0) || 2
  const metadata = { sampleRate, channels, duration, totalFrames: Math.ceil(duration * 30), codecName: 'pcm_f32le' }
  return { video, videoInfo, audioInfo, mixer, metadata }
}
// Copy is legal only if a single, complete, unmodified stream is the soundtrack.
function copySource(project, plan = mediaPlan(project)) {
  if (!plan) throw new Error('Import media before exporting')
  const { mixer, videoInfo, audioInfo, metadata } = plan
  const sources = []
  if (audioInfo && !mixer.audioMuted && mixer.audioVolume !== 0) sources.push({ path: project.audioPath, metadata: audioInfo, gain: mixer.audioVolume })
  if (videoInfo?.audio && !mixer.videoMuted && mixer.videoVolume !== 0) sources.push({ path: plan.video.videoPath, metadata: videoInfo.audio, gain: mixer.videoVolume })
  if (sources.length !== 1 || sources[0].gain !== 1 || mixer.masterVolume !== 1
      || Math.abs(sources[0].metadata.duration - metadata.duration) > 0.000001) {
    throw new Error('Source audio copy requires one unchanged soundtrack at its original length and volume. Choose lossless audio for a mixed or adjusted soundtrack.')
  }
  return sources[0]
}
function audioFilter(project, plan, analysis = false) {
  const { mixer, metadata } = plan
  const inputs = [], starts = [], filters = [], labels = []
  const selected = analysis && mixer.meterSource !== 'mix' ? mixer.meterSource : null
  for (const [kind, input, info] of [['video', plan.video?.videoPath, plan.videoInfo?.audio], ['audio', project.audioPath, plan.audioInfo]]) {
    if (!info || (selected && kind !== selected)) continue
    const index = inputs.length
    inputs.push(input)
    const gain = selected ? 10 ** (mixer.meterGainDb / 20)
      : mixer[`${kind}Muted`] ? 0 : mixer[`${kind}Volume`] * mixer.masterVolume
    const label = `s${index}`
    const offset = kind === 'video' ? plan.videoInfo.audioOffset : 0
    const position = (plan.exportStart || 0) - offset
    // A container with staggered streams seeks relative to container time, not
    // audio sample zero. Trim its decoded sample clock to preserve that offset.
    starts.push(offset === 0 ? Math.max(0, position) : 0)
    const trim = offset !== 0 && position > 0 ? `atrim=start=${position},` : ''
    const delay = position < 0 ? `adelay=${-position * 1000}:all=1,` : ''
    filters.push(`[${index}:a:0]aresample=${metadata.sampleRate},aformat=sample_fmts=fltp:channel_layouts=${metadata.channels === 1 ? 'mono' : 'stereo'},asetpts=PTS-STARTPTS,${trim}asetpts=PTS-STARTPTS,${delay}volume=${gain}:precision=double,apad,atrim=duration=${metadata.duration}[${label}]`)
    labels.push(`[${label}]`)
  }
  if (!labels.length) filters.push(`anullsrc=r=${metadata.sampleRate}:cl=${metadata.channels === 1 ? 'mono' : 'stereo'},atrim=duration=${metadata.duration}[out]`)
  else if (labels.length === 1) filters.push(`${labels[0]}anull[out]`)
  else filters.push(`${labels.join('')}amix=inputs=${labels.length}:normalize=0:duration=longest:dropout_transition=0[out]`)
  return { inputs, starts, filter: filters.join(';') }
}

function runFFmpeg(args, signal) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegExecutable(), ['-nostdin', '-hide_banner', '-loglevel', 'error', '-n', ...args],
      { stdio: ['ignore', 'ignore', 'pipe'], shell: false, windowsHide: true, signal })
    let errors = ''
    child.stderr.on('data', chunk => { errors = (errors + chunk).slice(-4096) })
    let failure
    child.once('error', error => { failure = error })
    child.once('close', code => code === 0 && !failure ? resolve() : reject(new Error(signal?.aborted ? 'Media preparation cancelled' : failure?.code === 'ENOENT' ? missingFfmpegMessage('FFmpeg') : `Media preparation failed: ${failure?.message || errors || code}`)))
  })
}
function fileKey(input) {
  if (!input) return ''
  const stat = fs.statSync(input)
  return [input, stat.size, stat.mtimeMs]
}

async function floatWavPeak(file, signal) {
  const fd = fs.openSync(file, 'r'), size = fs.fstatSync(fd).size
  const header = Buffer.alloc(12), chunk = Buffer.alloc(8), buffer = Buffer.alloc(65536)
  let peak = 0
  try {
    fs.readSync(fd, header, 0, 12, 0)
    if (!['RIFF', 'RF64'].includes(header.toString('ascii', 0, 4)) || header.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Invalid prepared audio')
    let offset = 12
    while (offset + 8 <= size) {
      fs.readSync(fd, chunk, 0, 8, offset)
      const length = chunk.readUInt32LE(4)
      if (chunk.toString('ascii', 0, 4) === 'data') {
        for (let position = offset + 8; position < size;) {
          if (signal?.aborted) throw new Error('Media preparation cancelled')
          const read = fs.readSync(fd, buffer, 0, Math.min(buffer.length, size - position), position)
          if (!read || read % 4) throw new Error('Invalid prepared audio samples')
          for (let index = 0; index < read; index += 4) {
            const value = Math.abs(buffer.readFloatLE(index))
            if (!Number.isFinite(value)) throw new Error('Prepared soundtrack contains invalid samples')
            peak = Math.max(peak, value)
          }
          position += read
          if ((position - offset - 8) % (4 * 1024 * 1024) === 0) await new Promise(resolve => setImmediate(resolve))
        }
        return peak
      }
      offset += 8 + length + length % 2
    }
    throw new Error('Prepared soundtrack has no samples')
  } finally { fs.closeSync(fd) }
}

class MediaCache {
  constructor(root) { this.root = path.resolve(root); this.entries = new Map(); this.controllers = new Set(); this.directories = new Set() }
  async prepare(project, signal, selectedRange) {
    let plan = mediaPlan(project)
    if (!plan) throw new Error('Import audio or video first')
    const range = exportRange(selectedRange, plan.metadata.duration)
    if (range.partial) plan = { ...plan, exportStart: range.start, metadata: { ...plan.metadata, duration: range.duration, totalFrames: Math.ceil(range.duration * 30 - 1e-7) } }
    // Preserve original-rate/codec playback and exact legacy behavior when untouched.
    const m = plan.mixer
    if (!range.partial && !plan.videoInfo && m.audioVolume === 1 && !m.audioMuted && m.masterVolume === 1
        && (m.meterSource === 'mix' || m.meterSource === 'audio' && m.meterGainDb === 0)) {
      return { ...plan, metadata: plan.audioInfo, outputPath: project.audioPath, analysisPath: project.audioPath }
    }
    const key = JSON.stringify([fileKey(project.audioPath), fileKey(plan.video?.videoPath), m, range])
    if (this.entries.has(key)) return this.entries.get(key)
    const controller = new AbortController()
    const abort = () => controller.abort()
    if (signal?.aborted) abort()
    signal?.addEventListener('abort', abort, { once: true })
    this.controllers.add(controller)
    const promise = (async () => {
      fs.mkdirSync(this.root, { recursive: true })
      const directory = path.join(this.root, randomUUID())
      fs.mkdirSync(directory)
      this.directories.add(directory)
      const volume = fs.statfsSync(directory, { bigint: true })
      const required = BigInt(Math.ceil(plan.metadata.duration * plan.metadata.sampleRate * plan.metadata.channels * 8 + 64 * 1024 * 1024))
      if (volume.bavail * volume.bsize < required) throw new Error('Not enough temporary disk space to prepare the soundtrack')
      const render = async (name, analysis) => {
        const recipe = audioFilter(project, plan, analysis), output = path.join(directory, name)
        await runFFmpeg([...recipe.inputs.flatMap((input, index) => ['-protocol_whitelist', 'file,pipe', ...(recipe.starts[index] > 0 ? ['-ss', String(recipe.starts[index])] : []), '-i', input]),
          '-filter_complex', recipe.filter, '-map', '[out]', '-c:a', 'pcm_f32le', '-rf64', 'auto', output], controller.signal)
        return output
      }
      const outputPath = await render('mix.wav', false)
      const analysisPath = m.meterSource === 'mix' ? outputPath : await render('meters.wav', true)
      return { ...plan, directory, outputPath, analysisPath, peak: await floatWavPeak(outputPath, controller.signal) }
    })()
    this.entries.set(key, promise)
    try { return await promise }
    catch (error) { this.entries.delete(key); throw error }
    finally { signal?.removeEventListener('abort', abort); this.controllers.delete(controller) }
  }
  cancel() { for (const controller of this.controllers) controller.abort() }
  async close() {
    this.cancel(); await Promise.allSettled(this.entries.values())
    for (const directory of this.directories) {
      assertCachePath(this.root, directory)
      if (path.dirname(directory) !== this.root || fs.lstatSync(directory).isSymbolicLink()) throw new Error('Unsafe media cache path')
      for (const name of ['mix.wav', 'meters.wav']) {
        const file = path.join(directory, name)
        if (fs.existsSync(file)) { if (fs.lstatSync(file).isSymbolicLink()) throw new Error('Unsafe media cache file'); fs.unlinkSync(file) }
      }
      if (!fs.readdirSync(directory).length) fs.rmdirSync(directory)
    }
    this.entries.clear(); this.directories.clear()
    if (fs.existsSync(this.root) && !fs.lstatSync(this.root).isSymbolicLink() && !fs.readdirSync(this.root).length) fs.rmdirSync(this.root)
  }
}
module.exports = { videoOf, saveVideoReferences, resolveVideoReferences, probeVideo, mediaPlan, copySource, audioFilter, runFFmpeg, MediaCache, floatWavPeak, assertCachePath }

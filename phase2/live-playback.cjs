const path = require('node:path')
const { utilityProcess } = require('electron')
const { randomUUID } = require('node:crypto')
const { analysisLanes } = require('./live-analysis.cjs')

class Lane {
  constructor(script) {
    this.pending = new Map(); this.next = 0; this.errors = ''
    this.child = utilityProcess.fork(script, [], { stdio: ['ignore', 'ignore', 'pipe'], serviceName: 'MusicMeters live meters' })
    this.spawned = new Promise(resolve => {
      this.child.once('spawn', () => resolve(true))
      this.child.once('exit', () => resolve(false))
    })
    this.child.stderr.on('data', chunk => { this.errors = (this.errors + chunk.toString()).slice(-2048) })
    this.child.on('message', value => {
      const pending = this.pending.get(value.id)
      if (!pending) return
      this.pending.delete(value.id); clearTimeout(pending.timer)
      value.error ? pending.reject(new Error(value.error)) : pending.resolve(value.frames)
    })
    const fail = error => { for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error) }; this.pending.clear() }
    this.child.once('error', fail)
    this.closed = new Promise(resolve => this.child.once('exit', code => {
      fail(new Error(this.errors || `Live analyzer stopped (${code})`)); resolve()
    }))
  }
  request(message) {
    const id = ++this.next
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Live analyzer timed out')) }, 15000)
      this.pending.set(id, { resolve, reject, timer })
      try { this.child.postMessage({ ...message, id }) }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error) }
    })
  }
  async stop() {
    if (!(await this.spawned) || !this.child.pid) return
    this.child.postMessage({ type: 'stop' })
    const timer = setTimeout(() => this.child.kill(), 3000)
    try { await this.closed } finally { clearTimeout(timer) }
  }
}

function mergeFrames(lanes) {
  return (lanes[0] || []).map((base, index) => {
    const value = { ...base }
    for (const lane of lanes.slice(1)) {
      const next = lane[index]
      if (!next || next.frameIndex !== value.frameIndex) throw new Error('Live analyzer streams lost synchronization')
      for (const key of ['spectra', 'oscilloscopes', 'spectrograms', 'waveforms', 'vus', 'loudness', 'waterfalls']) {
        value[key] = { ...value[key], ...next[key] }
      }
      if (next.x) { value.x = next.x; value.y = next.y; value.multiband = next.multiband }
    }
    return value
  })
}

class LivePlayback {
  constructor(script = path.join(__dirname, 'live-analysis-child.cjs')) {
    this.script = script; this.lanes = []; this.cleanup = Promise.resolve(); this.generation = 0
    this.media = null; this.session = null; this.pulling = false
  }
  stopWorkers() {
    const lanes = this.lanes; this.lanes = []
    this.media = null; this.session = null
    this.cleanup = this.cleanup.catch(() => {}).then(() => Promise.all(lanes.map(lane => lane.stop())))
    return this.cleanup
  }
  cancel() { ++this.generation; return this.stopWorkers() }
  async open(project, metadata, frame) {
    const generation = ++this.generation
    await this.stopWorkers()
    if (generation !== this.generation) return { superseded: true }
    const groups = analysisLanes(project, metadata.sampleRate)
    const lanes = groups.map(() => new Lane(this.script)); this.lanes = lanes
    try {
      const frames = mergeFrames(await Promise.all(lanes.map((lane, index) => lane.request({
        type: 'open', input: project.audioPath, metadata, layers: groups[index], frame, count: 4,
      }))))
      if (generation !== this.generation) return { superseded: true }
      this.session = randomUUID()
      const type = { '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.flac': 'audio/flac' }[path.extname(project.audioPath).toLowerCase()]
      this.media = { path: project.audioPath, url: `musicmeters-preview://audio/${this.session}`, type }
      return { session: this.session, url: this.media.url, frames }
    } catch (error) {
      if (generation !== this.generation) return { superseded: true }
      await this.cancel(); throw error
    }
  }
  async pull(session, count) {
    if (!Number.isSafeInteger(count) || count < 1 || count > 6) throw new Error('Invalid playback buffer size')
    if (typeof session !== 'string') throw new Error('Invalid playback session')
    if (!this.session || session !== this.session) return []
    if (this.pulling) throw new Error('Playback request already pending')
    const lanes = this.lanes, generation = this.generation
    this.pulling = true
    try {
      const result = mergeFrames(await Promise.all(lanes.map(lane => lane.request({ type: 'pull', count }))))
      if (generation !== this.generation) return []
      return result
    } catch (error) {
      if (generation !== this.generation) return []
      throw error
    } finally { this.pulling = false }
  }
}
module.exports = { LivePlayback, mergeFrames }

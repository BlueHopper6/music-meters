const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { randomUUID } = require('node:crypto')
const { probeVideo, runFFmpeg, assertCachePath } = require('./project-media.cjs')

// Sequential offline decoding: bounded by one PNG plus stream backpressure.
// FFmpeg maps variable-rate input onto the composition's 30 FPS clock.
class VideoFrames {
  constructor(layer, duration, maxDimension = 3840) {
    this.layer = layer; this.index = 0; this.pending = Buffer.alloc(0)
    const info = probeVideo(layer.videoPath)
    this.duration = info.duration
    this.child = spawn('ffmpeg', ['-nostdin', '-v', 'error',
      ...(layer.endBehavior === 'loop' ? ['-stream_loop', '-1'] : []),
      '-protocol_whitelist', 'file,pipe', '-i', layer.videoPath, '-map', `0:${info.streamIndex}`, '-an',
      '-vf', `fps=30,scale=w='min(iw,${maxDimension})':h='min(ih,${maxDimension})':force_original_aspect_ratio=decrease,setsar=1,tpad=stop_mode=clone:stop_duration=${duration}`,
      '-t', String(duration), '-f', 'image2pipe', '-c:v', 'png', 'pipe:1'],
    { stdio: ['ignore', 'pipe', 'pipe'], shell: false, windowsHide: true })
    this.iterator = this.child.stdout[Symbol.asyncIterator]()
    let errors = ''
    this.child.stderr.on('data', value => { errors = (errors + value).slice(-4096) })
    this.done = new Promise((resolve, reject) => {
      this.child.once('error', reject)
      this.child.once('close', code => code === 0 ? resolve() : reject(new Error(`Video decoder failed: ${errors || code}`)))
    })
    this.done.catch(() => {})
  }
  async read() {
    if (this.layer.endBehavior === 'hide' && this.index / 30 >= this.duration) { this.index++; return '' }
    let offset = 8
    for (;;) {
      while (this.pending.length >= offset + 12) {
        if (!this.pending.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error('Invalid decoded video frame')
        const length = this.pending.readUInt32BE(offset)
        if (length > 128 * 1024 * 1024) throw new Error('Decoded video frame is too large')
        if (this.pending.length < offset + 12 + length) break
        const end = this.pending.toString('ascii', offset + 4, offset + 8) === 'IEND'
        offset += length + 12
        if (end) {
          const frame = this.pending.subarray(0, offset).toString('base64')
          this.pending = this.pending.subarray(offset); this.index++
          return `data:image/png;base64,${frame}`
        }
      }
      const next = await this.iterator.next()
      if (next.done) { await this.done; throw new Error('Video decoder ended before the composition') }
      this.pending = Buffer.concat([this.pending, next.value])
      if (this.pending.length > 128 * 1024 * 1024) throw new Error('Decoded video frame exceeded its buffer limit')
    }
  }
  async close() {
    this.child.stdout.destroy()
    if (this.child.exitCode === null) this.child.kill()
    let timer
    try { await Promise.race([this.done.catch(() => {}), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Video decoder did not stop')), 5000) })]) }
    finally { clearTimeout(timer); this.child.stderr.destroy() }
  }
}

class VideoPreviewCache {
  constructor(root) { this.root = path.resolve(root); this.entries = new Map(); this.media = new Map(); this.controllers = new Set(); this.files = new Set() }
  async prepare(input) {
    const stat = fs.statSync(input), key = JSON.stringify([input, stat.size, stat.mtimeMs])
    if (this.entries.has(key)) {
      const cached = await this.entries.get(key)
      this.media.set(cached.url, { path: cached.path, url: cached.url, type: 'video/mp4' })
      return cached
    }
    const controller = new AbortController(); this.controllers.add(controller)
    const promise = (async () => {
      const info = probeVideo(input)
      fs.mkdirSync(this.root, { recursive: true })
      const volume = fs.statfsSync(this.root, { bigint: true })
      if (volume.bavail * volume.bsize < BigInt(Math.ceil(info.duration * 2 * 1024 * 1024 + 64 * 1024 * 1024))) throw new Error('Not enough temporary disk space to prepare the video preview')
      const token = randomUUID(), output = path.join(this.root, `${token}.mp4`)
      this.files.add(output)
      await runFFmpeg(['-protocol_whitelist', 'file,pipe', '-i', input, '-map', `0:${info.streamIndex}`, '-an',
        '-vf', "fps=30,scale=w='min(iw,1280)':h='min(ih,1280)':force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1",
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-g', '30', '-movflags', '+faststart', output], controller.signal)
      const url = `musicmeters-preview://video/${token}`
      this.media.set(url, { path: output, url, type: 'video/mp4' })
      return { url, path: output, duration: info.duration }
    })()
    this.entries.set(key, promise)
    try { return await promise } catch (error) { this.entries.delete(key); throw error }
    finally { this.controllers.delete(controller) }
  }
  cancel() { for (const controller of this.controllers) controller.abort() }
  async close() {
    this.cancel(); await Promise.allSettled(this.entries.values())
    for (const file of this.files) {
      assertCachePath(this.root, file)
      if (path.dirname(file) !== this.root) throw new Error('Unsafe video cache path')
      if (fs.existsSync(file)) { if (fs.lstatSync(file).isSymbolicLink()) throw new Error('Unsafe video cache file'); fs.unlinkSync(file) }
    }
    this.files.clear(); this.media.clear(); this.entries.clear()
    if (fs.existsSync(this.root) && !fs.lstatSync(this.root).isSymbolicLink() && !fs.readdirSync(this.root).length) fs.rmdirSync(this.root)
  }
}
module.exports = { VideoFrames, VideoPreviewCache }

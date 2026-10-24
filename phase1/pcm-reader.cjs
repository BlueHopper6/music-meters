const { spawn } = require('node:child_process')

// FFmpeg's stdout is consumed only when the analyzer needs more samples. Node's
// stream backpressure keeps the decoder from filling application memory.
class PcmReader {
  constructor(input, sampleRate, ffmpeg = 'ffmpeg') {
    this.child = spawn(ffmpeg, [
      '-nostdin', '-v', 'error', '-i', input, '-map', '0:a:0',
      '-f', 'f32le', '-acodec', 'pcm_f32le', '-ac', '2',
      '-ar', String(sampleRate), 'pipe:1',
    ], { stdio: ['ignore', 'pipe', 'pipe'], shell: false })
    this.iterator = this.child.stdout[Symbol.asyncIterator]()
    this.pending = Buffer.alloc(0)
    this.offset = 0
    this.errorText = ''
    this.child.stderr.on('data', data => {
      this.errorText = (this.errorText + data.toString()).slice(-8192)
    })
    this.exited = new Promise(resolve => {
      this.child.once('exit', (code, signal) => resolve({ code, signal }))
    })
    this.done = new Promise((resolve, reject) => {
      this.child.once('error', reject)
      this.child.once('close', code => code === 0
        ? resolve()
        : reject(new Error(`Audio decoder exited ${code}: ${this.errorText}`)))
    })
    // Prevent a killed decoder's rejection from becoming unhandled while the
    // exporter is stopping its other children.
    this.done.catch(() => {})
  }

  async readFrames(wanted) {
    const bytes = Buffer.allocUnsafe(wanted * 8)
    let filled = 0
    while (filled < bytes.length) {
      if (this.offset >= this.pending.length) {
        const next = await this.iterator.next()
        if (next.done) break
        this.pending = next.value
        this.offset = 0
      }
      const length = Math.min(bytes.length - filled, this.pending.length - this.offset)
      this.pending.copy(bytes, filled, this.offset, this.offset + length)
      this.offset += length
      filled += length
    }
    if (filled % 8 !== 0) throw new Error(`Decoder produced a partial stereo sample: ${filled} bytes`)
    if (filled < bytes.length) await this.done
    const frames = filled / 8
    const left = new Float32Array(frames)
    const right = new Float32Array(frames)
    for (let i = 0; i < frames; i++) {
      left[i] = bytes.readFloatLE(i * 8)
      right[i] = bytes.readFloatLE(i * 8 + 4)
    }
    return { left, right, frames }
  }

  async close() {
    // An unread stdout pipe may never reach `close` after a cancelled export.
    // Destroy it and wait for process exit instead of waiting for stream close.
    this.child.stdout.destroy()
    if (this.child.exitCode === null && this.child.signalCode === null) this.child.kill()
    let timer
    try {
      await Promise.race([
        this.exited,
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Decoder did not stop within 5 seconds')), 5000) }),
      ])
    } catch {
      this.child.kill('SIGKILL')
      let forceTimer
      try {
        await Promise.race([
          this.exited,
          new Promise((_, reject) => { forceTimer = setTimeout(() => reject(new Error('Decoder did not stop after force kill')), 5000) }),
        ])
      } finally {
        clearTimeout(forceTimer)
      }
    } finally {
      clearTimeout(timer)
      this.child.stderr.destroy()
    }
  }
}

module.exports = { PcmReader }

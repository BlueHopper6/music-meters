const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { execFileSync } = require('node:child_process')
const { VideoFrames } = require('../video-frames.cjs')

test('offline video supplies the ceiling frame count at fractional duration boundaries', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'musicmeters-video-frames-'))
  const videoPath = path.join(dir, 'short.mp4')
  execFileSync('ffmpeg', ['-v','error','-f','lavfi','-i','color=c=navy:size=160x90:rate=30:duration=0.1','-an','-c:v','libx264','-pix_fmt','yuv420p',videoPath], { windowsHide:true })
  for (const duration of [0.1, 0.10000000000000002, 0.100001, 1 / 30]) {
    const reader = new VideoFrames({videoPath,endBehavior:'freeze'}, duration)
    try {
      for (let index=0;index<Math.ceil(duration*30);index++) assert.match(await reader.read(), /^data:image\/png;base64,/)
      assert.equal(reader.index, Math.ceil(duration*30))
    } finally { await reader.close() }
  }
})

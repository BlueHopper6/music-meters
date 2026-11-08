const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { spawn, execFileSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const { packagedExecutable } = require('../packaged-executable.cjs')
const { MediaCache } = require('../../phase2/project-media.cjs')
const run = (tool, args) => execFileSync(tool, args, { maxBuffer: 128 * 1024 * 1024, windowsHide: true })
async function main() {
  const executable = packagedExecutable(path.resolve(process.argv[2])), dir = path.resolve(process.argv[3])
  if (fs.existsSync(dir)) throw new Error('Choose a new evidence directory')
  fs.mkdirSync(dir, { recursive: true }); fs.mkdirSync(path.join(dir, 'temp'))
  const video = path.join(dir, 'clip.mkv'), song = path.join(dir, 'music.wav')
  run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=24:duration=1.5',
    '-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=48000:duration=1.5', '-c:v', 'ffv1', '-c:a', 'pcm_s24le', video])
  run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=990:sample_rate=96000:duration=2', '-c:a', 'pcm_s24le', song])
  run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=navy:size=160x90:rate=30:duration=0.1', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(dir, 'silent.mp4')])
  const logPath = path.join(dir, 'editor.log'), log = fs.openSync(logPath, 'wx')
  const child = spawn(executable, [], { env: { ...process.env, TEMP: path.join(dir, 'temp'), TMP: path.join(dir, 'temp'), TMPDIR: path.join(dir, 'temp'),
    PHASE2_HEADLESS: '1', PHASE2_TEST_INPUT: song, MUSICMETERS_TEST_VIDEO: video,
    MUSICMETERS_MEDIA_SMOKE: '1', MUSICMETERS_MEDIA_SMOKE_DIR: dir, PHASE5_TEST_USER_DATA: path.join(dir, 'profile') },
    stdio: ['ignore', log, log], shell: false, windowsHide: true })
  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error('Media editor smoke timed out')) }, 300000)
    child.once('error', reject); child.once('close', value => { clearTimeout(timer); resolve(value) })
  })
  fs.closeSync(log)
  assert.equal(code, 0, fs.readFileSync(logPath, 'utf8'))
  const project = JSON.parse(fs.readFileSync(path.join(dir, 'project-snapshot.json'), 'utf8'))
  const cache = new MediaCache(path.join(dir, 'verification-cache'))
  const expected = await cache.prepare(project)
  const decode = file => run('ffmpeg', ['-v', 'error', '-i', file, '-map', '0:a:0', '-c:a', 'pcm_f32le', '-f', 'f32le', 'pipe:1'])
  const original = decode(expected.outputPath), results = []
  const hash = bytes => createHash('sha256').update(bytes).digest('hex')
  for (const [mode, extension, codec] of [['master', 'mkv', 'pcm_f32le'], ['flac', 'mkv', 'flac'], ['aac', 'mp4', 'aac']]) {
    const output = path.join(dir, `export-${mode}.${extension}`)
    const probe = JSON.parse(run('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', output]))
    const audio = probe.streams.find(s => s.codec_type === 'audio'), picture = probe.streams.find(s => s.codec_type === 'video')
    assert.equal(audio.codec_name, codec)
    // AAC's standard rate ceiling is 96 kHz. Lossless options retain the mix rate.
    assert.equal(Number(audio.sample_rate), 96000)
    const decoded = decode(output)
    let maxError = mode === 'aac' ? null : 0
    if (mode !== 'aac') {
      assert.equal(decoded.length, original.length)
      for (let index = 0; index < decoded.length; index += 4) maxError = Math.max(maxError, Math.abs(decoded.readFloatLE(index) - original.readFloatLE(index)))
      assert.ok(maxError <= (mode === 'master' ? 0 : 0.0000003), `${mode} error: ${maxError}`)
    }
    run('ffmpeg', ['-v', 'error', '-xerror', '-i', output, '-f', 'null', '-'])
    let pixelHash
    if (mode === 'master') {
      assert.equal(picture.codec_name, 'ffv1')
      const encodedPixels = run('ffmpeg', ['-v', 'error', '-i', output, '-frames:v', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1'])
      const renderedPixels = run('ffmpeg', ['-v', 'error', '-i', `${output}.rendered.png`, '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1'])
      assert.equal(hash(encodedPixels), hash(renderedPixels)); pixelHash = hash(encodedPixels)
    }
    results.push({ mode, codec, sampleRate: audio.sample_rate, maxError, pixelHash })
  }
  for (const name of ['video-only.mkv', 'silent-4k-portrait.mkv']) {
    const output = path.join(dir, name)
    const probe = JSON.parse(run('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', output]))
    const audio = probe.streams.find(s => s.codec_type === 'audio'), video = probe.streams.find(s => s.codec_type === 'video')
    assert.equal(audio.codec_name, 'flac')
    run('ffmpeg', ['-v', 'error', '-xerror', '-i', output, '-f', 'null', '-'])
    if (name.startsWith('silent')) {
      assert.equal(video.width, 2160); assert.equal(video.height, 3840)
      const samples = decode(output)
      for (let offset = 0; offset < samples.length; offset += 4) assert.ok(Math.abs(samples.readFloatLE(offset)) <= 2 ** -23, 'silence is preserved apart from integer dither')
    }
    results.push({ mode: name, codec: audio.codec_name, width: video.width, height: video.height })
  }
  // A processed integer soundtrack must fail before silently clipping.
  const hot = path.join(dir, 'hot.wav')
  run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.1', '-af', 'volume=6', '-c:a', 'pcm_s24le', hot])
  const clippedOutput = path.join(dir, 'overload.mkv'), clippedLog = path.join(dir, 'overload.log')
  const clippedFd = fs.openSync(clippedLog, 'wx')
  const overload = spawn(executable, [], { env: { ...process.env, TEMP: path.join(dir, 'temp'), TMP: path.join(dir, 'temp'), TMPDIR: path.join(dir, 'temp'),
    MUSICMETERS_EXPORT_PROFILE: path.join(dir, 'overload-profile'), PHASE2_JOB: JSON.stringify({
      project: { ...project, layers: [], audioPath: hot, mixer: { ...project.mixer, audioVolume: 2, masterVolume: 2, durationMode: 'audio' } },
      output: clippedOutput, preset: '720p', audioMode: 'flac', cancelFile: path.join(dir, 'overload.cancel') }) },
    stdio: ['ignore', clippedFd, clippedFd], shell: false, windowsHide: true })
  const overloadCode = await new Promise((resolve, reject) => { overload.once('error', reject); overload.once('close', resolve) })
  fs.closeSync(clippedFd)
  assert.equal(overloadCode, 1)
  assert.match(fs.readFileSync(clippedLog, 'utf8'), /exceeds full scale/)
  assert.equal(fs.existsSync(clippedOutput), false)
  assert.equal(fs.readdirSync(dir).some(name => name.startsWith('overload.mkv.partial')), false)
  results.push({ mode: 'overload', rejectedBeforeClipping: true })
  await cache.close()
  fs.writeFileSync(path.join(dir, 'verification.json'), JSON.stringify(results, null, 2))
  console.log(JSON.stringify({ dir, results }))
}
main().catch(error => { console.error(error.stack || error); process.exitCode = 1 })

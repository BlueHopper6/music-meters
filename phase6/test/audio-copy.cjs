const { packagedExecutable } = require('../packaged-executable.cjs')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { spawn, spawnSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const { defaultProject, spectrumLayer } = require('../../phase2/project.cjs')

function run(command, args, maxBuffer = 16 * 1024 * 1024) {
  const result = spawnSync(command, args, { maxBuffer })
  assert.equal(result.status, 0, `${command}: ${result.stderr.toString() || result.error}`)
  return result.stdout
}

function probe(file) {
  return JSON.parse(run('ffprobe', ['-v', 'error', '-show_entries',
    'stream=index,codec_type,codec_name,sample_rate,channels,start_time:format=duration',
    '-of', 'json', file]).toString())
}

function digest(bytes) { return createHash('sha256').update(bytes).digest('hex') }

async function exportCase(executable, dir, name, input, audioMode = 'copy', options = {}) {
  const output = options.output || path.join(dir, `${name}.${audioMode === 'copy' ? 'mkv' : 'mp4'}`)
  const project = { ...defaultProject(), title: name, layers: [spectrumLayer()], audioPath: input }
  const logPath = path.join(dir, `${name}.log`)
  const log = fs.openSync(logPath, 'w')
  const child = spawn(executable, [], { env: { ...process.env,
    PHASE6_TEST_ENCODER: options.encoder || '',
    PHASE2_JOB: JSON.stringify({ project, output, preset: '720p', audioMode,
      cancelFile: path.join(dir, `${name}.cancel`), cancelAfterFrames: options.cancelAfterFrames }),
  }, stdio: ['ignore', log, log], shell: false, windowsHide: true })
  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`${name} timed out`)) }, 180000)
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('close', value => { clearTimeout(timer); resolve(value) })
  })
  fs.closeSync(log)
  return { code, output, logPath, text: fs.readFileSync(logPath, 'utf8') }
}

function decodedSamples(file) {
  return run('ffmpeg', ['-v', 'error', '-i', file, '-map', '0:a:0',
    '-ac', '2', '-ar', '48000', '-f', 'f32le', 'pipe:1'])
}

function compareDecoded(source, output) {
  const first = decodedSamples(source)
  const second = decodedSamples(output)
  const left = new Float32Array(first.buffer, first.byteOffset, first.length / 4)
  const right = new Float32Array(second.buffer, second.byteOffset, second.length / 4)
  const available = Math.min(left.length, right.length)
  let best = { lag: 0, correlation: -1 }
  for (let lag = -2304; lag <= 2304; lag += 2) {
    let cross = 0, firstEnergy = 0, secondEnergy = 0
    for (let index = 5000; index < Math.min(available - 5000, 25000); index += 53) {
      const shifted = index + lag
      if (shifted < 0 || shifted >= right.length) continue
      const a = left[index], b = right[shifted]
      cross += a * b; firstEnergy += a * a; secondEnergy += b * b
    }
    const correlation = cross / Math.sqrt(firstEnergy * secondEnergy)
    if (correlation > best.correlation) best = { lag, correlation }
  }
  assert.ok(best.correlation > 0.998, `Decoded audio differs: ${JSON.stringify(best)}`)
  assert.ok(Math.abs(best.lag) / (48000 * 2) < 0.05, `Audio shifted too far: ${JSON.stringify(best)}`)
  return best
}

function verifyCopy(source, output, expectedCodec) {
  const original = probe(source)
  const result = probe(output)
  const inputAudio = original.streams.find(stream => stream.codec_type === 'audio')
  const outputAudio = result.streams.find(stream => stream.codec_type === 'audio')
  const video = result.streams.find(stream => stream.codec_type === 'video')
  assert.equal(outputAudio.codec_name, expectedCodec)
  assert.equal(outputAudio.sample_rate, inputAudio.sample_rate)
  assert.equal(outputAudio.channels, inputAudio.channels)
  assert.equal(video.codec_name, 'h264')
  const frames = Number(run('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0',
    '-show_entries', 'stream=nb_read_frames', '-of', 'default=nw=1:nk=1', output]).toString().trim())
  assert.equal(frames, Math.ceil(Number(original.format.duration) * 30))
  const startDelta = Math.abs(Number(outputAudio.start_time) - Number(video.start_time))
  assert.ok(startDelta <= 0.05, `Audio/video start offset ${startDelta} s`)
  const durationDelta = Math.abs(Number(result.format.duration) - Number(original.format.duration))
  assert.ok(durationDelta <= 0.09, `Output duration changed by ${durationDelta} s`)
  const raw = file => run('ffmpeg', ['-v', 'error', '-i', file, '-map', '0:a:0',
    '-c:a', 'copy', '-f', 'data', 'pipe:1'])
  assert.equal(digest(raw(output)), digest(raw(source)), 'Copied audio packet content differs')
  const decoded = compareDecoded(source, output)
  run('ffmpeg', ['-v', 'error', '-xerror', '-i', output, '-f', 'null', '-'])
  return { codec: expectedCodec, frames, startDelta, durationDelta, packetSha256: digest(raw(output)), decoded }
}

async function main() {
  if (process.argv.length !== 4) throw new Error('Usage: node phase6/test/audio-copy.cjs <package-dir> <new-output-dir>')
  const executable = packagedExecutable(path.resolve(process.argv[2]))
  const dir = path.resolve(process.argv[3])
  if (fs.existsSync(dir)) throw new Error(`Output already exists: ${dir}`)
  fs.mkdirSync(dir, { recursive: true })
  const cases = [
    { name: 'Café & [mix] #1', ext: 'MP3', codec: 'libmp3lame', expect: 'mp3' },
    { name: 'PCM 24-bit stereo', ext: 'wav', codec: 'pcm_s24le', expect: 'pcm_s24le' },
    { name: 'PCM float stereo', ext: 'wav', codec: 'pcm_f32le', expect: 'pcm_f32le' },
    { name: 'Lossless FLAC', ext: 'flac', codec: 'flac', expect: 'flac' },
  ]
  const summary = []
  for (const item of cases) {
    const input = path.join(dir, `${item.name}.${item.ext}`)
    run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
      'anoisesrc=color=white:amplitude=0.2:duration=2:sample_rate=48000:seed=42',
      '-ac', '2', '-c:a', item.codec, input])
    const result = await exportCase(executable, dir, item.name, input)
    assert.equal(result.code, 0, result.text)
    summary.push({ name: item.name, ...verifyCopy(input, result.output, item.expect) })
  }
  const sample = path.join(dir, 'PCM 24-bit stereo.wav')
  const firstOutput = path.join(dir, 'PCM 24-bit stereo.mkv')
  const originalHash = digest(fs.readFileSync(firstOutput))
  const existing = await exportCase(executable, dir, 'existing', sample, 'copy', { output: firstOutput })
  assert.notEqual(existing.code, 0)
  assert.match(existing.text, /Output already exists/)
  assert.equal(digest(fs.readFileSync(firstOutput)), originalHash)
  const repeat = await exportCase(executable, dir, 'repeat', sample)
  assert.equal(repeat.code, 0, repeat.text)
  verifyCopy(sample, repeat.output, 'pcm_s24le')
  const cancelled = await exportCase(executable, dir, 'cancelled', sample, 'copy', { cancelAfterFrames: 15 })
  assert.notEqual(cancelled.code, 0)
  assert.match(cancelled.text, /Export cancelled/)
  assert.ok(!fs.existsSync(cancelled.output))
  assert.deepEqual(fs.readdirSync(dir).filter(name => name.startsWith('cancelled.mkv.partial-')), [])
  const failed = await exportCase(executable, dir, 'encoder-failure', sample, 'copy', { encoder: process.execPath })
  assert.notEqual(failed.code, 0)
  assert.ok(!fs.existsSync(failed.output))
  assert.deepEqual(fs.readdirSync(dir).filter(name => name.startsWith('encoder-failure.mkv.partial-')), [])
  const unsupported = path.join(dir, 'Unsupported ADPCM.wav')
  run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
    'sine=frequency=440:duration=1', '-c:a', 'adpcm_ima_wav', unsupported])
  const badCodec = await exportCase(executable, dir, 'unsupported-codec', unsupported)
  assert.notEqual(badCodec.code, 0)
  assert.match(badCodec.text, /Cannot copy adpcm_ima_wav audio/)
  const badExtension = await exportCase(executable, dir, 'wrong-extension', sample, 'copy',
    { output: path.join(dir, 'wrong-extension.mp4') })
  assert.notEqual(badExtension.code, 0)
  assert.match(badExtension.text, /MKV output must end in .mkv/)
  const badMp4Extension = await exportCase(executable, dir, 'wrong-mp4-extension', sample, 'aac',
    { output: path.join(dir, 'wrong-mp4-extension.mkv') })
  assert.notEqual(badMp4Extension.code, 0)
  assert.match(badMp4Extension.text, /MP4 output must end in .mp4/)
  fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n')
  console.log(JSON.stringify({ dir, cases: summary, repeat: 'pass', cancellation: 'pass',
    encoderFailure: 'pass', codecValidation: 'pass', extensionValidation: 'pass' }))
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1 })

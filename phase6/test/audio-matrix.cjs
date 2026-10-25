const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { spawn, spawnSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const { defaultProject, compositionProject, spectrumLayer, imageLayer } = require('../../phase2/project.cjs')

function command(name, args) {
  const result = spawnSync(name, args, { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`${name} failed: ${result.stderr || result.error}`)
  return result.stdout
}

async function exportCase(executable, dir, name, input, options = {}) {
  const output = path.join(dir, `${name}.mp4`)
  const project = options.project || { ...defaultProject(), title: name, layers: [spectrumLayer()], audioPath: input }
  const logPath = path.join(dir, `${name}.log`)
  const log = fs.openSync(logPath, 'w')
  const child = spawn(executable, [], { env: { ...process.env, PHASE2_JOB: JSON.stringify({
    project, output, preset: '720p', cancelFile: path.join(dir, `${name}.cancel`),
    cancelAfterFrames: options.cancelAfterFrames,
  }) }, stdio: ['ignore', log, log], shell: false, windowsHide: true })
  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`${name} timed out`)) }, 180000)
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('close', exit => { clearTimeout(timer); resolve(exit) })
  })
  fs.closeSync(log)
  const text = fs.readFileSync(logPath, 'utf8')
  return { code, output, logPath, text }
}

function hash(file) { return createHash('sha256').update(fs.readFileSync(file)).digest('hex') }

async function main() {
  if (process.argv.length !== 4) throw new Error('Usage: node phase6/test/audio-matrix.cjs <package-dir> <new-output-dir>')
  const executable = path.join(path.resolve(process.argv[2]), 'electron.exe')
  const dir = path.resolve(process.argv[3])
  if (fs.existsSync(dir)) throw new Error(`Matrix output already exists: ${dir}`)
  fs.mkdirSync(dir, { recursive: true })
  const cases = [
    { name: 'mono-44100', filter: 'sine=frequency=440:duration=1.5', channels: 1, rate: 44100, ext: 'wav' },
    { name: 'stereo-48000', filter: 'sine=frequency=880:duration=1.5', channels: 2, rate: 48000, ext: 'flac' },
    { name: 'stereo-96000', filter: 'sine=frequency=1000:duration=1.5', channels: 2, rate: 96000, ext: 'wav' },
    { name: 'silent-stereo', filter: 'anullsrc=channel_layout=stereo:sample_rate=48000:d=1.5', channels: 2, rate: 48000, ext: 'wav' },
    { name: 'clipped-mp3', filter: 'sine=frequency=440:duration=1.5', channels: 2, rate: 48000, ext: 'mp3', volume: true },
  ]
  const summary = []
  for (const item of cases) {
    const input = path.join(dir, `${item.name}.${item.ext}`)
    const args = ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', item.filter]
    if (item.volume) args.push('-af', 'volume=20')
    args.push('-ac', String(item.channels), '-ar', String(item.rate), input)
    command('ffmpeg', args)
    const result = await exportCase(executable, dir, item.name, input)
    assert.equal(result.code, 0, `${item.name}: ${result.text}`)
    command('ffmpeg', ['-v', 'error', '-xerror', '-i', result.output, '-f', 'null', '-'])
    const probe = JSON.parse(command('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', result.output]))
    const video = probe.streams.find(stream => stream.codec_type === 'video')
    const audio = probe.streams.find(stream => stream.codec_type === 'audio')
    assert.equal(Number(video.nb_frames), 45)
    assert.equal(audio.codec_name, 'aac')
    summary.push({ name: item.name, inputChannels: item.channels, inputRate: item.rate,
      videoFrames: Number(video.nb_frames), output: result.output, logPath: result.logPath })
  }
  const sample = path.join(dir, 'stereo-48000.flac')
  const originalHash = hash(path.join(dir, 'stereo-48000.mp4'))
  const existing = await exportCase(executable, dir, 'stereo-48000', sample)
  assert.notEqual(existing.code, 0)
  assert.match(existing.text, /Output already exists/)
  assert.equal(hash(existing.output), originalHash)
  const cancelled = await exportCase(executable, dir, 'cancelled', sample, { cancelAfterFrames: 15 })
  assert.notEqual(cancelled.code, 0)
  assert.match(cancelled.text, /Export cancelled/)
  assert.ok(!fs.existsSync(cancelled.output))
  assert.equal(fs.readdirSync(dir).filter(name => name.startsWith('cancelled.mp4.partial-')).length, 0)
  const unreadable = path.join(dir, 'unreadable.wav')
  fs.writeFileSync(unreadable, 'not audio')
  const bad = await exportCase(executable, dir, 'unreadable', unreadable)
  assert.notEqual(bad.code, 0)
  assert.match(bad.text, /Could not read audio metadata/)
  assert.ok(!fs.existsSync(bad.output))
  const missingImage = { ...compositionProject(), title: 'Missing image', audioPath: sample,
    layers: [spectrumLayer(), { ...imageLayer(), imagePath: path.join(dir, 'gone.png') }] }
  const absent = await exportCase(executable, dir, 'missing-image', sample, { project: missingImage })
  assert.notEqual(absent.code, 0)
  assert.match(absent.text, /ENOENT|missing|unavailable/i)
  assert.ok(!fs.existsSync(absent.output))
  summary.push({ name: 'existing-file', result: 'rejected unchanged', logPath: existing.logPath })
  summary.push({ name: 'cancellation', result: 'no final or partial MP4', logPath: cancelled.logPath })
  summary.push({ name: 'unreadable-audio', result: 'rejected', logPath: bad.logPath })
  summary.push({ name: 'missing-image', result: 'rejected', logPath: absent.logPath })
  fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify(summary, null, 2))
  console.log(JSON.stringify({ dir, cases: summary.length }))
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1 })

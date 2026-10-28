const { packagedExecutable } = require('../packaged-executable.cjs')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { spawn, spawnSync } = require('node:child_process')
const { defaultProject, spectrumLayer } = require('../../phase2/project.cjs')

async function main() {
  if (process.argv.length !== 4) throw new Error('Usage: node phase6/test/long-export.cjs <package-dir> <new-output-dir>')
  const executable = packagedExecutable(path.resolve(process.argv[2]))
  const dir = path.resolve(process.argv[3])
  if (fs.existsSync(dir)) throw new Error(`Output already exists: ${dir}`)
  fs.mkdirSync(dir, { recursive: true })
  const input = path.join(dir, 'two-minute-440.wav')
  const fixture = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
    'sine=frequency=440:duration=120', '-ac', '2', '-ar', '48000', input], { encoding: 'utf8' })
  if (fixture.status !== 0) throw new Error(fixture.stderr)
  const output = path.join(dir, 'two-minute-output.mp4')
  const project = { ...defaultProject(), title: 'Two minute stress', audioPath: input,
    layers: [spectrumLayer()] }
  const logPath = path.join(dir, 'export.log')
  const log = fs.openSync(logPath, 'w')
  const child = spawn(executable, [], { env: { ...process.env, PHASE2_JOB: JSON.stringify({
    project, output, preset: '720p', cancelFile: path.join(dir, 'never.cancel') }) },
    stdio: ['ignore', log, log], shell: false, windowsHide: true })
  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error('Long export timed out')) }, 600000)
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('close', value => { clearTimeout(timer); resolve(value) })
  })
  fs.closeSync(log)
  const lines = fs.readFileSync(logPath, 'utf8').split(/\r?\n/).filter(line => line.startsWith('{'))
  const events = lines.map(line => JSON.parse(line))
  const finished = events.find(event => event.event === 'finished')
  assert.equal(code, 0, `Long export failed; see ${logPath}`)
  assert.equal(finished?.frames, 3600)
  const probe = spawnSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', output], { encoding: 'utf8' })
  assert.equal(probe.status, 0)
  const streams = JSON.parse(probe.stdout).streams
  assert.equal(Number(streams.find(stream => stream.codec_type === 'video').nb_frames), 3600)
  assert.equal(streams.find(stream => stream.codec_type === 'audio').codec_name, 'aac')
  const decoded = spawnSync('ffmpeg', ['-v', 'error', '-xerror', '-i', output, '-f', 'null', '-'],
    { encoding: 'utf8', timeout: 180000 })
  assert.equal(decoded.status, 0, decoded.stderr)
  for (const [time, name] of [[1, 'early.png'], [119, 'late.png']]) {
    const frame = path.join(dir, name)
    const result = spawnSync('ffmpeg', ['-v', 'error', '-ss', String(time), '-i', output,
      '-frames:v', '1', frame], { encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    assert.ok(fs.statSync(frame).size > 10000)
  }
  console.log(JSON.stringify({ output, logPath, frames: finished.frames,
    elapsedSeconds: finished.elapsedSeconds, peakMainRssBytes: finished.peakMainRssBytes,
    earlyFrame: path.join(dir, 'early.png'), lateFrame: path.join(dir, 'late.png') }))
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1 })

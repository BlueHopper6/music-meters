const { packagedExecutable } = require('../packaged-executable.cjs')
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { spawn, spawnSync } = require('node:child_process')

function run(command, args, binary = false) {
  const result = spawnSync(command, args, { encoding: binary ? undefined : 'utf8',
    maxBuffer: 32 * 1024 * 1024, windowsHide: true })
  if (result.status !== 0) throw new Error(String(result.stderr || result.error || `${command} failed`))
  return result.stdout
}

async function main() {
  if (process.argv.length !== 4) throw new Error('Usage: node phase6/test/layer-backgrounds-smoke.cjs <package-dir> <new-output-dir>')
  const pack = path.resolve(process.argv[2]), dir = path.resolve(process.argv[3])
  if (fs.existsSync(dir)) throw new Error(`Output already exists: ${dir}`)
  fs.mkdirSync(dir, { recursive: true })
  const { starter } = require(path.join(pack, 'resources', 'app', 'phase2', 'templates.cjs'))
  const { orientProject, exportDimensions } = require(path.join(pack, 'resources', 'app', 'phase2', 'project.cjs'))
  const audioPath = path.join(dir, 'synthetic.wav')
  run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-ac', '2', '-ar', '48000', audioPath])
  const summary = []
  for (const orientation of ['landscape', 'portrait']) {
    let project = { ...starter('Observatory'), audioPath }
    project.layers = project.layers.filter(layer => layer.type !== 'image'
      && (layer.type !== 'text' || layer.name === 'song name'))
    for (const layer of project.layers) if (layer.type !== 'text' || layer.name === 'song name') {
      layer.backgroundEnabled = true
      layer.backgroundColor = '#80c040'
      layer.backgroundOpacity = 0.5
    }
    const title = project.layers.find(layer => layer.name === 'song name')
    title.opacity = 0.5 // Overall layer opacity multiplies the background's own alpha.
    title.y = 80 // Keep the rotated fixture fully inside the canvas.
    title.rotation = 8
    if (orientation === 'portrait') {
      project = orientProject(project, orientation)
      // A compact landscape dashboard does not become a portrait grid merely by
      // fitting it: minimum meter sizes can overlap. Use spaced test panels.
      project.layers.filter(layer => layer.type !== 'text').forEach((layer, index) => {
        Object.assign(layer, { x: 60 + (index % 2) * 320, y: 270 + Math.floor(index / 2) * 210, w: 280, h: 150 })
      })
      Object.assign(project.layers.find(layer => layer.type === 'text'), { x: 60, y: 80, w: 600, h: 70 })
    }
    const output = path.join(dir, `${orientation}.mp4`), logPath = path.join(dir, `${orientation}.log`)
    fs.writeFileSync(path.join(dir, `${orientation}.json`), JSON.stringify(project, null, 2) + '\n')
    const log = fs.openSync(logPath, 'wx')
    const child = spawn(packagedExecutable(pack), [], {
      env: { ...process.env, MUSICMETERS_EXPORT_PROFILE: path.join(dir, `${orientation}-profile`),
        PHASE2_JOB: JSON.stringify({ project, output, preset: '1080p', audioMode: 'aac', cancelFile: path.join(dir, 'never.cancel') }) },
      stdio: ['ignore', log, log], shell: false, windowsHide: true,
    })
    let code
    try {
      code = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { child.kill(); reject(new Error('Background export timed out')) }, 120000)
        child.once('error', error => { clearTimeout(timer); reject(error) })
        child.once('close', result => { clearTimeout(timer); resolve(result) })
      })
    } finally { fs.closeSync(log) }
    if (code !== 0) throw new Error(`${orientation} export exited ${code}; see ${logPath}`)
    const video = JSON.parse(run('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', output]))
      .streams.find(stream => stream.codec_type === 'video')
    const dimensions = exportDimensions(project, '1080p')
    assert.deepEqual([video.width, video.height, Number(video.nb_frames)], [dimensions.width, dimensions.height, 60])
    run('ffmpeg', ['-v', 'error', '-xerror', '-i', output, '-f', 'null', '-'])
    const frame = path.join(dir, `${orientation}.png`)
    run('ffmpeg', ['-v', 'error', '-i', output, '-vf', 'select=eq(n\\,30)', '-frames:v', '1', frame])
    const rgb = run('ffmpeg', ['-v', 'error', '-i', frame, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], true)
    function pixel(x, y) {
      const at = (Math.round(y * 1.5) * video.width + Math.round(x * 1.5)) * 3
      return [...rgb.subarray(at, at + 3)]
    }
    for (const meter of project.layers.filter(layer => layer.type !== 'text')) {
      const color = pixel(meter.x + 3, meter.y + 3)
      assert.ok(color.every((value, index) => Math.abs(value - [69, 103, 44][index]) < 18),
        `${orientation}: ${meter.type} background alpha/color incorrect: ${color}`)
    }
    const heading = project.layers.find(layer => layer.name === 'song name')
    const angle = heading.rotation * Math.PI / 180
    const dx = -heading.w / 2 + 5, dy = -heading.h / 2 + 5
    const color = pixel(heading.x + heading.w / 2 + dx * Math.cos(angle) - dy * Math.sin(angle),
      heading.y + heading.h / 2 + dx * Math.sin(angle) + dy * Math.cos(angle))
    assert.ok(color.every((value, index) => Math.abs(value - [39, 59, 33][index]) < 15),
      `${orientation}: rotated text background must combine layer/background alpha: ${color}`)
    summary.push({ orientation, output, frame, dimensions, frames: 60 })
    console.log(`PASS: ${orientation}, eight meter backgrounds, rotated text, opacity, 1080p export and full decode`)
  }
  fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n')
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1 })

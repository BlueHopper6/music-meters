const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')
const { spawnSync, spawn } = require('node:child_process')
const { build } = require('../../phase2/build.cjs')

const root = path.resolve(__dirname, '..', '..')
function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const kind = Buffer.from(type)
  const size = Buffer.alloc(4); size.writeUInt32BE(data.length)
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(Buffer.concat([kind, data])))
  return Buffer.concat([size, kind, data, checksum])
}
function artwork(target, red, blue) {
  const width = 256, height = 256
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6
  const rows = []
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(width * 4 + 1)
    for (let x = 0; x < width; x++) {
      const at = 1 + 4 * x
      row[at] = (red + x / 3) & 255; row[at + 1] = (40 + y / 2) & 255
      row[at + 2] = (blue + y / 3) & 255; row[at + 3] = 255
    }
    rows.push(row)
  }
  fs.writeFileSync(target, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]))
}
async function main() {
  const dir = path.join(root, 'artifacts', 'phase5', `gate-${Date.now()}`)
  fs.mkdirSync(dir, { recursive: false })
  const audioA = path.join(dir, 'song-A-440.wav'), audioB = path.join(dir, 'song-B-880.wav')
  for (const [frequency, output] of [[440, audioA], [880, audioB]]) {
    const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
      `sine=frequency=${frequency}:duration=4`, '-ac', '2', '-ar', '48000', '-c:a', 'pcm_s16le', output], { encoding: 'utf8' })
    if (result.status !== 0) throw new Error(`Fixture generation failed: ${result.stderr}`)
  }
  const artA = path.join(dir, 'art-A.png'), artB = path.join(dir, 'art-B.png')
  artwork(artA, 160, 30); artwork(artB, 30, 160)
  const userData = path.join(dir, 'user-data'); fs.mkdirSync(userData)
  const electron = await build()
  const logPath = path.join(dir, 'editor.log')
  const log = fs.openSync(logPath, 'w')
  const child = spawn(electron, [path.join(root, 'phase2', 'editor-app')], {
    env: { ...process.env, PHASE2_HEADLESS: '1', PHASE5_WORKFLOW_SMOKE: '1', PHASE5_GATE_DIR: dir,
      PHASE5_TEST_USER_DATA: userData, PHASE2_TEST_INPUT: audioA, PHASE2_TEST_IMPORT_PATH: audioB,
      PHASE4_TEST_IMAGE_PATH: artA, PHASE2_TEST_PROJECT_PATH: path.join(dir, 'song-B-project.json'),
      PHASE2_TEST_OUTPUT_PATH: path.join(dir, 'song-B-1080p.mp4'), PHASE5_TEST_ART_B: artB },
    stdio: ['ignore', log, log], shell: false, windowsHide: true,
  })
  const code = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { child.kill(); reject(new Error(`Phase 5 editor timed out; see ${logPath}`)) }, 300000)
    child.once('error', error => { clearTimeout(timeout); reject(error) })
    child.once('close', result => { clearTimeout(timeout); resolve(result) })
  })
  fs.closeSync(log)
  console.log(dir)
  if (code !== 0) throw new Error(`Phase 5 editor gate failed (exit ${code}); see ${logPath}`)
}
main().catch(error => { console.error(error.stack || error); process.exitCode = 1 })

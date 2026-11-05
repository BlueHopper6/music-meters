const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { compositionProject, normalizeProject, videoLayer, normalizeMixer, exportDimensions } = require('../project.cjs')
const { MediaCache, probeVideo, mediaPlan, copySource, saveVideoReferences, resolveVideoReferences } = require('../project-media.cjs')
const { VideoFrames } = require('../video-frames.cjs')
const { gradientPixels } = require('../gradient.cjs')
const { layoutFromProject, applyTemplate } = require('../templates.cjs')
const { readLibraryProject, renameLibraryProject, copyLibraryProject, removeOriginalProject, deleteLibraryProject } = require('../project-library.cjs')
const run = args => execFileSync('ffmpeg', ['-v', 'error', '-nostdin', ...args], { maxBuffer: 32 * 1024 * 1024, windowsHide: true })
const root = path.resolve('artifacts/phase2')
fs.mkdirSync(root, { recursive: true })
const dir = fs.mkdtempSync(path.join(root, 'media-unit-'))
const video = path.join(dir, 'video.mkv'), song = path.join(dir, 'song.wav')
run(['-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=24:duration=1.5', '-f', 'lavfi', '-i',
  'sine=frequency=330:sample_rate=48000:duration=1.5', '-c:v', 'ffv1', '-c:a', 'pcm_s24le', video])
run(['-f', 'lavfi', '-i', 'sine=frequency=990:sample_rate=96000:duration=2', '-c:a', 'pcm_s24le', song])
const project = () => ({ ...compositionProject(), audioPath: song, layers: [{ ...videoLayer(), videoPath: video }], mixer: normalizeMixer() })
const decode = file => run(['-i', file, '-map', '0:a:0', '-f', 'f32le', '-ac', '1', '-ar', '96000', 'pipe:1'])
function amplitude(bytes, frequency, start = 0.25, seconds = 0.5) {
  let real = 0, imaginary = 0
  const count = Math.floor(seconds * 96000), offset = Math.floor(start * 96000)
  for (let index = 0; index < count; index++) {
    const angle = 2 * Math.PI * frequency * index / 96000
    const sample = bytes.readFloatLE((index + offset) * 4)
    real += sample * Math.cos(angle); imaginary += sample * Math.sin(angle)
  }
  return 2 * Math.hypot(real, imaginary) / count
}

test('video, routing and external references round-trip; malformed settings are rejected', () => {
  const original = normalizeProject(project())
  const target = path.join(dir, 'project', 'saved.json')
  const stored = saveVideoReferences(original, target)
  assert.equal(stored.layers[0].videoPath, undefined)
  assert.equal(resolveVideoReferences(stored, target).layers[0].videoPath, video)
  assert.equal(probeVideo(video).duration, 1.5)
  for (const value of [NaN, -1, 3]) assert.throws(() => normalizeMixer({ audioVolume: value }))
  assert.throws(() => normalizeMixer({ videoMuted: 'false' }))
  assert.throws(() => normalizeMixer({ meterSource: 'anything' }))
  assert.throws(() => normalizeProject({ ...original, layers: [original.layers[0], { ...original.layers[0], id: 'second' }] }), /One video/)
  assert.throws(() => normalizeProject({ ...original, layers: [{ ...original.layers[0], videoPath: 'https://example.com/v.mp4' }] }), /local/)
  assert.deepEqual(exportDimensions(original, '2160p'), { width: 3840, height: 2160 })
})

test('soundtrack levels and source-only meters are independent and retain the highest input sample rate', async () => {
  const cache = new MediaCache(path.join(dir, 'mix-cache'))
  const input = project()
  input.mixer = normalizeMixer({ videoVolume: 0.8, audioVolume: 0.2, masterVolume: 0.5, meterSource: 'audio' })
  try {
    const result = await cache.prepare(input)
    assert.equal(result.metadata.sampleRate, 96000)
    assert.equal(result.metadata.duration, 2)
    const mix = decode(result.outputPath), meters = decode(result.analysisPath)
    assert.ok(Math.abs(amplitude(mix, 330) - 0.05) < 0.0001)
    assert.ok(Math.abs(amplitude(mix, 990) - 0.0125) < 0.0001)
    assert.ok(amplitude(meters, 330) < 0.00001)
    assert.ok(Math.abs(amplitude(meters, 990) - 0.125) < 0.0001)
    assert.ok(amplitude(mix, 330, 1.6, 0.2) < 0.00001, 'shorter video audio must end, independently of picture looping')
    input.mixer.audioMuted = true
    const muted = await cache.prepare(input)
    assert.ok(amplitude(decode(muted.outputPath), 990) < 0.00001)
    assert.ok(amplitude(decode(muted.analysisPath), 990) > 0.12, 'selected original source remains available for visual-only analysis')
    input.mixer.meterSource = 'mix'
    const finalMix = await cache.prepare(input)
    assert.equal(finalMix.outputPath, finalMix.analysisPath)
    assert.throws(() => copySource(input), /unchanged soundtrack/)
  } finally { await cache.close() }
})

test('silent video, duration choices and unchanged audio remain valid', async () => {
  const silent = path.join(dir, 'silent.mp4')
  run(['-i', video, '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', silent])
  const input = { ...project(), audioPath: '', layers: [{ ...videoLayer(), videoPath: silent }], mixer: normalizeMixer() }
  const cache = new MediaCache(path.join(dir, 'silent-cache'))
  try {
    const result = await cache.prepare(input)
    assert.equal(result.peak, 0)
    assert.equal(result.metadata.duration, 1.5)
    assert.throws(() => mediaPlan({ ...input, mixer: normalizeMixer({ durationMode: 'audio' }) }), /Import audio/)
    const audioOnly = { ...project(), layers: [], mixer: normalizeMixer() }
    const unchanged = await cache.prepare(audioOnly)
    assert.equal(unchanged.outputPath, song)
    assert.equal(copySource(audioOnly).path, song)
  } finally { await cache.close() }
})

test('cancelled preparation closes its child and cleans only its session files', async () => {
  const cache = new MediaCache(path.join(dir, 'cancel-cache')), controller = new AbortController()
  controller.abort()
  try { await assert.rejects(() => cache.prepare(project(), controller.signal), /cancelled/) }
  finally { await cache.close() }
  assert.equal(fs.existsSync(path.join(dir, 'cancel-cache')), false)
  assert.ok(fs.existsSync(video)); assert.ok(fs.existsSync(song))
})

test('offline video decoding follows 30 FPS, freezes its tail, hides, and loops without loading all frames', async () => {
  const layer = { ...videoLayer(), videoPath: video }
  const frames = new VideoFrames(layer, 2, 160)
  let last, frozen
  try { for (let index = 0; index < 60; index++) { const frame = await frames.read(); if (index === 44) last = frame; if (index === 59) frozen = frame } }
  finally { await frames.close() }
  assert.ok(last.startsWith('data:image/png;base64,')); assert.equal(frozen, last)
  const hidden = new VideoFrames({ ...layer, endBehavior: 'hide' }, 2, 160)
  try { for (let index = 0; index < 45; index++) await hidden.read(); assert.equal(await hidden.read(), '') }
  finally { await hidden.close() }
  const loop = new VideoFrames({ ...layer, endBehavior: 'loop' }, 3, 160)
  try {
    const first = await loop.read()
    for (let index = 1; index < 45; index++) await loop.read()
    assert.equal(await loop.read(), first)
  } finally { await loop.close() }
})

test('templates clear video media and retain current video/audio routing when applying another layout', () => {
  const input = project(), layout = layoutFromProject(input)
  assert.equal(layout.layers[0].videoPath, '')
  const applied = applyTemplate({ ...compositionProject(), layers: [] }, input)
  assert.equal(applied.layers[0].videoPath, video)
  assert.equal(applied.audioPath, song)
  assert.deepEqual(applied.mixer, input.mixer)
})

test('video references survive project rename/copy/move/recycling without changing original media', async () => {
  const folder = path.join(dir, 'Original'), source = path.join(folder, 'Original.json')
  fs.mkdirSync(folder)
  const document = saveVideoReferences({ ...project(), title: 'Original', audioPath: undefined, audioRelativePath: '../song.wav' }, source)
  fs.writeFileSync(source, JSON.stringify(document))
  const originalBytes = fs.readFileSync(video)
  const renamed = renameLibraryProject(source, 'Renamed')
  assert.equal(readLibraryProject(renamed.path).project.layers[0].videoPath, video)
  const target = path.join(dir, 'Copied', 'Copied.json')
  const copied = await copyLibraryProject(renamed.path, target, 'Copied')
  assert.equal(readLibraryProject(target).project.layers[0].videoPath, video)
  removeOriginalProject(copied)
  assert.equal(fs.existsSync(renamed.path), false)
  let recycled
  await deleteLibraryProject(target, async staging => {
    recycled = path.join(dir, 'recycled')
    fs.renameSync(staging, recycled)
  })
  assert.equal(readLibraryProject(path.join(recycled, 'Copied', 'Copied.json')).project.layers[0].videoPath, video)
  assert.deepEqual(fs.readFileSync(video), originalBytes)
})

test('video audio offsets stay aligned to the first video frame', async () => {
  const delayed = path.join(dir, 'delayed.mkv')
  run(['-i', video, '-itsoffset', '0.25', '-i', song, '-map', '0:v:0', '-map', '1:a:0', '-t', '1.5', '-c:v', 'copy', '-c:a', 'pcm_s24le', delayed])
  const input = { ...project(), audioPath: '', layers: [{ ...videoLayer(), videoPath: delayed }] }
  const cache = new MediaCache(path.join(dir, 'offset-cache'))
  try {
    assert.ok(Math.abs(probeVideo(delayed).audioOffset - 0.25) < 0.001)
    const result = await cache.prepare(input), samples = decode(result.outputPath)
    assert.ok(amplitude(samples, 990, 0, 0.2) < 0.00001)
    assert.ok(amplitude(samples, 990, 0.3, 0.5) > 0.12)
  } finally { await cache.close() }
})

test('picture ending uses the video stream duration when embedded audio lasts longer', async () => {
  const uneven = path.join(dir, 'unequal-streams.mkv')
  run(['-i', video, '-i', song, '-map', '0:v:0', '-map', '1:a:0', '-c', 'copy', uneven])
  assert.equal(probeVideo(uneven).duration, 1.5)
  const input = { ...project(), audioPath: '', layers: [{ ...videoLayer(), videoPath: uneven, endBehavior: 'hide' }] }
  assert.equal(mediaPlan(input).metadata.duration, 2, 'longest includes the video file’s longer audio stream')
  input.mixer.durationMode = 'video'
  assert.equal(mediaPlan(input).metadata.duration, 1.5)
  const reader = new VideoFrames(input.layers[0], 2, 160)
  try { for (let index = 0; index < 45; index++) await reader.read(); assert.equal(await reader.read(), '') }
  finally { await reader.close() }
})

test('gradient texture is deterministic, opaque, bounded and produces intermediate spatial detail', () => {
  const plain = gradientPixels(128, 72, '#101010', '#202020', 0)
  const textured = gradientPixels(128, 72, '#101010', '#202020', 2)
  assert.deepEqual(textured, gradientPixels(128, 72, '#101010', '#202020', 2))
  assert.notDeepEqual(plain, textured)
  for (let offset = 0; offset < plain.length; offset += 4) {
    assert.equal(textured[offset + 3], 255)
    assert.ok(Math.abs(textured[offset] - plain[offset]) <= 2)
  }
})

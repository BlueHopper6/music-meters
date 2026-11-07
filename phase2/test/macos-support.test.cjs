const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const {
  MACOS_FALLBACK_DIRS,
  resolveMediaTool,
  missingFfmpegMessage,
} = require('../ffmpeg.cjs')
const { electronRelativeExecutable } = require('../../phase6/electron-runtime.cjs')
const {
  packagedBundleRoot,
  packagedExecutable,
  packagedAppRoot,
} = require('../../phase6/packaged-executable.cjs')
const { canvasFontStack } = require('../project.cjs')
const {
  parseMacOsSystemProfilerFonts,
  resolveFontFallback,
  assertInstalledFonts,
} = require('../fonts.cjs')
const {
  isDarwinRootSystemSymlink,
  samePath,
} = require('../media-storage.cjs')
const {
  projectAudioReference,
  resolveProjectAudio,
} = require('../project-audio.cjs')
const {
  darwinCompileFlags,
  scanBinaryPrivacy,
} = require('../../phase6/build-native.cjs')
const {
  extractPngsFromIco,
  buildIcnsFromBrandAssets,
  buildInfoPlist,
} = require('../../phase6/package-macos.cjs')

test('ffmpeg discovery checks env override, PATH, and macOS Homebrew/MacPorts fallbacks', () => {
  assert.ok(MACOS_FALLBACK_DIRS.includes('/opt/homebrew/bin'))
  assert.ok(MACOS_FALLBACK_DIRS.includes('/usr/local/bin'))
  assert.ok(MACOS_FALLBACK_DIRS.includes('/opt/local/bin'))

  const resolved = resolveMediaTool('ffmpeg', {
    platform: 'darwin',
    env: { PATH: '/usr/bin:/bin' },
    isExecutableFile: candidate => candidate === '/opt/homebrew/bin/ffmpeg',
  })
  assert.equal(resolved, '/opt/homebrew/bin/ffmpeg')

  assert.throws(() => resolveMediaTool('ffmpeg', {
    platform: 'darwin',
    env: { MUSICMETERS_FFMPEG_PATH: '/nonexistent/custom/ffmpeg' },
    isExecutableFile: () => false,
  }), /MUSICMETERS_FFMPEG_PATH/)

  assert.match(missingFfmpegMessage('FFmpeg', 'darwin'), /brew install ffmpeg|PATH/)
  assert.match(missingFfmpegMessage('FFmpeg', 'win32'), /Install FFmpeg/)
})

test('Electron runtime and packaged bundle helpers support darwin and win32 layouts', () => {
  assert.equal(electronRelativeExecutable('darwin'), path.join('Electron.app', 'Contents', 'MacOS', 'Electron'))
  assert.equal(electronRelativeExecutable('win32'), 'electron.exe')

  const root = path.resolve('artifacts/phase2')
  fs.mkdirSync(root, { recursive: true })
  const temp = fs.mkdtempSync(path.join(root, 'macos-pkg-test-'))
  try {
    const bundle = path.join(temp, 'MusicMeters.app')
    const macosDir = path.join(bundle, 'Contents', 'MacOS')
    const appDir = path.join(bundle, 'Contents', 'Resources', 'app')
    fs.mkdirSync(macosDir, { recursive: true })
    fs.mkdirSync(appDir, { recursive: true })
    fs.writeFileSync(path.join(macosDir, 'MusicMeters'), '')

    assert.equal(packagedBundleRoot(temp, 'darwin'), bundle)
    assert.equal(packagedBundleRoot(bundle, 'darwin'), bundle)
    assert.equal(packagedExecutable(temp, 'darwin'), path.join(macosDir, 'MusicMeters'))
    assert.equal(packagedExecutable(bundle, 'darwin'), path.join(macosDir, 'MusicMeters'))
    assert.equal(packagedAppRoot(temp, 'darwin'), appDir)
    assert.equal(packagedAppRoot(bundle, 'darwin'), appDir)
  } finally {
    fs.rmSync(temp, { recursive: true, force: true })
  }
})

test('macOS font discovery and cross-platform fallback preserve Windows factory templates on macOS', () => {
  const sampleJson = JSON.stringify({
    SPFontsDataType: [
      {
        _name: 'HelveticaNeue.ttc',
        enabled: 'yes',
        valid: 'yes',
        typefaces: [
          { family: 'Helvetica Neue', enabled: 'yes', valid: 'yes' },
          { family: '.AppleSystemUIFont', enabled: 'yes', valid: 'yes' },
        ],
      },
      {
        _name: 'Disabled.ttf',
        enabled: 'no',
        valid: 'yes',
        typefaces: [{ family: 'Disabled Font', enabled: 'no' }],
      },
    ],
  })
  assert.deepEqual(parseMacOsSystemProfilerFonts(sampleJson), ['Helvetica Neue'])
  assert.equal(resolveFontFallback('Segoe UI', ['Helvetica Neue', 'Menlo']), 'Helvetica Neue')
  assert.equal(resolveFontFallback('Consolas', ['Helvetica Neue', 'Menlo']), 'Menlo')
  assert.match(canvasFontStack('Segoe UI'), /"Segoe UI".*"Helvetica Neue"/)

  assert.doesNotThrow(() => assertInstalledFonts({
    version: 2,
    layers: [
      { type: 'text', fontFamily: 'Segoe UI' },
      { type: 'text', fontFamily: 'Consolas' },
    ],
  }, ['Helvetica Neue', 'Menlo']))
})

test('Darwin root system symlinks (/var, /tmp, /etc) are distinguished from user symlinks', () => {
  assert.equal(isDarwinRootSystemSymlink('/var', 'darwin'), true)
  assert.equal(isDarwinRootSystemSymlink('/tmp', 'darwin'), true)
  assert.equal(isDarwinRootSystemSymlink('/etc', 'darwin'), true)
  assert.equal(isDarwinRootSystemSymlink('/var/folders/xx', 'darwin'), false)
  assert.equal(isDarwinRootSystemSymlink('/Users/alice/link', 'darwin'), false)
  assert.equal(isDarwinRootSystemSymlink('/var', 'win32'), false)
})

test('project audio references preserve /Volumes paths and cross-OS Windows drive references without corruption', () => {
  const unresolvableWinPath = 'Z:\\Music\\Track 01.wav'
  const resolved = resolveProjectAudio('/Users/alice/Music/project.json', unresolvableWinPath)
  assert.ok(resolved.endsWith(path.join('Music', 'Track 01.wav')))

  const ref = projectAudioReference('/Users/alice/Projects/Demo/Demo.json', '/Volumes/ExternalDrive/Songs/Track.wav')
  assert.equal(ref, '/Volumes/ExternalDrive/Songs/Track.wav')
})

test('samePath compares existing files by device and inode', () => {
  const root = path.resolve('artifacts/phase2')
  fs.mkdirSync(root, { recursive: true })
  const temp = fs.mkdtempSync(path.join(root, 'samepath-test-'))
  try {
    const first = path.join(temp, 'first.json')
    const second = path.join(temp, 'second.json')
    fs.writeFileSync(first, '{}')
    fs.writeFileSync(second, '{}')
    assert.equal(samePath(first, first), true)
    assert.equal(samePath(first, second), false)
  } finally {
    fs.rmSync(temp, { recursive: true, force: true })
  }
})

test('macOS native build privacy scanner and .icns / Info.plist generators produce valid outputs', () => {
  const flags = darwinCompileFlags('/repo/music-meters', '/repo/music-meters/upstream/prism')
  assert.match(flags, /-ffile-prefix-map=\/repo\/music-meters=\./)
  assert.match(flags, /-fdebug-prefix-map=\/repo\/music-meters\/upstream\/prism=\./)

  const root = path.resolve('artifacts/phase2')
  fs.mkdirSync(root, { recursive: true })
  const temp = fs.mkdtempSync(path.join(root, 'privacy-test-'))
  try {
    const cleanBin = path.join(temp, 'clean.node')
    fs.writeFileSync(cleanBin, Buffer.from('Mach-O clean binary payload ./src/main.cpp', 'utf8'))
    assert.equal(scanBinaryPrivacy(cleanBin), true)

    const leakedBin = path.join(temp, 'leaked.node')
    fs.writeFileSync(leakedBin, Buffer.from('assertion failed at /Users/developer/secret/main.cpp', 'utf8'))
    assert.throws(() => scanBinaryPrivacy(leakedBin), /privacy check failed/)
  } finally {
    fs.rmSync(temp, { recursive: true, force: true })
  }

  const icoBytes = fs.readFileSync(path.resolve('phase2/editor-app/assets/brand/music-meters.ico'))
  const extractedPngs = extractPngsFromIco(icoBytes)
  assert.ok(extractedPngs.length >= 1, 'Expected embedded PNG payloads in music-meters.ico')

  const icns = buildIcnsFromBrandAssets()
  assert.equal(icns.toString('ascii', 0, 4), 'icns')
  assert.equal(icns.readUInt32BE(4), icns.length)

  const plist = buildInfoPlist({
    displayName: 'MusicMeters',
    executable: 'MusicMeters',
    bundleId: 'com.musicmeters.app',
    version: '1.3.0',
  })
  assert.match(plist, /<key>CFBundleExecutable<\/key>\s*<string>MusicMeters<\/string>/)
  assert.match(plist, /<key>CFBundleIdentifier<\/key>\s*<string>com\.musicmeters\.app<\/string>/)
  assert.match(plist, /<key>CFBundleIconFile<\/key>\s*<string>music-meters\.icns<\/string>/)
})

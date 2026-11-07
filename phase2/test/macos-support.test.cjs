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
const identity = require('../../phase6/application.cjs')
const {
  packagedBundleRoot,
  packagedExecutable,
  packagedAppRoot,
} = require('../../phase6/packaged-executable.cjs')
const { canvasFontStack, videoLayer } = require('../project.cjs')
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
  isForeignPlatformReference,
  isWindowsDriveReference,
  isMacVolumeReference,
} = require('../project-audio.cjs')
const { readLibraryProject, renameLibraryProject } = require('../project-library.cjs')
const { probeAudio } = require('../audio.cjs')
const { probeVideo } = require('../project-media.cjs')
const { assetData } = require('../assets.cjs')
const { prepareStoredMedia } = require('../media-storage.cjs')
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
  assert.equal(identity.macosExecutable, 'MusicMeters')
  assert.equal(identity.macosBundleName, 'MusicMeters.app')
  assert.equal(identity.macosIconFile, 'music-meters.icns')
  assert.equal(identity.macosMinimumSystemVersion, '12.0')
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

test('R1: foreign-platform media references preserve exact identity without colliding or probing local paths', async () => {
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
  const setPlatform = value => Object.defineProperty(process, 'platform', {
    value,
    configurable: true,
    enumerable: true,
    writable: false,
  })
  try {
    assert.equal(isWindowsDriveReference('C:\\Music\\Track 01.wav'), true)
    assert.equal(isWindowsDriveReference('D:/Videos/Clip.mp4'), true)
    assert.equal(isMacVolumeReference('/Volumes/ExternalDrive/Songs/Track.wav'), true)
    assert.equal(isForeignPlatformReference('C:\\Music\\Track 01.wav', 'darwin'), true)
    assert.equal(isForeignPlatformReference('C:\\Music\\Track 01.wav', 'win32'), false)
    assert.equal(isForeignPlatformReference('/Volumes/ExternalDrive/Songs/Track.wav', 'win32'), true)
    assert.equal(isForeignPlatformReference('/Volumes/ExternalDrive/Songs/Track.wav', 'darwin'), false)

    setPlatform('darwin')
    const resolvedC = resolveProjectAudio('/Users/alice/Projects/Demo/Demo.json', 'C:\\Music\\Track 01.wav')
    const resolvedD = resolveProjectAudio('/Users/alice/Projects/Demo/Demo.json', 'D:\\Music\\Track 01.wav')
    assert.equal(resolvedC, 'C:\\Music\\Track 01.wav')
    assert.equal(resolvedD, 'D:\\Music\\Track 01.wav')
    assert.notEqual(resolvedC, resolvedD)
    assert.equal(projectAudioReference('/Users/alice/Projects/Demo/Demo.json', resolvedC), 'C:\\Music\\Track 01.wav')
    assert.equal(projectAudioReference('/Users/alice/Projects/SaveAs/Copy.json', resolvedD), 'D:\\Music\\Track 01.wav')
    assert.throws(() => probeAudio(resolvedC), /Choose a local audio file/)
    assert.throws(() => probeVideo('D:\\Videos\\Background.mp4'), /Choose a local video file/)
    assert.deepEqual(assetData({
      version: 2,
      background: { type: 'image', imagePath: 'C:\\Art\\Cover.png', storage: 'link', color: '#000000', color2: '#000000', fit: 'cover' },
      layers: [],
    }, false), {})

    const volRef = projectAudioReference('/Users/alice/Projects/Demo/Demo.json', '/Volumes/ExternalDrive/Songs/Track.wav')
    assert.equal(volRef, '/Volumes/ExternalDrive/Songs/Track.wav')

    setPlatform('win32')
    const resolvedMacVol = resolveProjectAudio('C:\\Projects\\Demo\\Demo.json', '/Volumes/ExternalDrive/Songs/Track.wav')
    assert.equal(resolvedMacVol, '/Volumes/ExternalDrive/Songs/Track.wav')
    assert.equal(projectAudioReference('C:\\Projects\\Demo\\Demo.json', resolvedMacVol), '/Volumes/ExternalDrive/Songs/Track.wav')
    assert.equal(projectAudioReference('D:\\Other\\Copy.json', resolvedMacVol), '/Volumes/ExternalDrive/Songs/Track.wav')
    assert.throws(() => probeAudio(resolvedMacVol), /Choose a local audio file/)
    assert.throws(() => probeVideo('/Volumes/ExternalDrive/Videos/Clip.mp4'), /Choose a local video file/)
  } finally {
    if (originalPlatform) Object.defineProperty(process, 'platform', originalPlatform)
  }

  const root = path.resolve('artifacts/phase2')
  fs.mkdirSync(root, { recursive: true })
  const temp = fs.mkdtempSync(path.join(root, 'r1-foreign-rename-'))
  try {
    const foreignAudio = process.platform === 'win32' ? '/Volumes/ExternalDrive/Songs/Track.wav' : 'C:\\Music\\Track.wav'
    const foreignVideo = process.platform === 'win32' ? '/Volumes/ExternalDrive/Videos/Clip.mp4' : 'D:\\Videos\\Clip.mp4'
    const foreignImage = process.platform === 'win32' ? '/Volumes/ExternalDrive/Art/Cover.png' : 'E:\\Art\\Cover.png'
    const folder = path.join(temp, 'Demo')
    fs.mkdirSync(folder, { recursive: true })
    const projectFile = path.join(folder, 'Demo.json')
    fs.writeFileSync(projectFile, JSON.stringify({
      version: 2,
      title: 'Demo',
      width: 1280,
      height: 720,
      fps: 30,
      audioRelativePath: foreignAudio,
      audioStorage: 'link',
      background: { type: 'image', color: '#000000', color2: '#111111', imagePath: foreignImage, storage: 'link', fit: 'cover' },
      layers: [
        { ...videoLayer('vid-1'), storage: 'link', videoPath: undefined, videoRelativePath: foreignVideo },
      ],
    }, null, 2) + '\n')
    const opened = readLibraryProject(projectFile)
    assert.equal(opened.project.audioPath, foreignAudio)
    assert.equal(opened.project.background.imagePath, foreignImage)
    assert.equal(opened.project.layers[0].videoPath, foreignVideo)

    const prepared = await prepareStoredMedia({ ...opened.project, audioStorage: 'copy' }, projectFile)
    assert.equal(prepared.audioPath, foreignAudio)

    const renamed = renameLibraryProject(projectFile, 'Renamed Demo')
    const reopened = readLibraryProject(renamed.path)
    assert.equal(reopened.stored.audioRelativePath, foreignAudio)
    assert.equal(reopened.stored.background.imagePath, foreignImage)
    assert.equal(reopened.stored.layers[0].videoRelativePath, foreignVideo)
  } finally {
    fs.rmSync(temp, { recursive: true, force: true })
  }
})

test('R2: macOS package uses MACOS-README.md and archives full package directory with provenance and source metadata', () => {
  const macReadmePath = path.resolve('phase6/MACOS-README.md')
  assert.ok(fs.existsSync(macReadmePath), 'Expected phase6/MACOS-README.md to exist')
  const macReadme = fs.readFileSync(macReadmePath, 'utf8')
  assert.match(macReadme, /MusicMeters\.app/)
  assert.doesNotMatch(macReadme, /Run `MusicMeters\.exe`/)
  assert.match(macReadme, /SOURCE-ARCHIVE\.json/)
  assert.match(macReadme, /BUILD-PROVENANCE\.json/)

  const pkgMac = require('../../phase6/package-macos.cjs')
  assert.equal(typeof pkgMac.packExistingMacPackage, 'function')
  const root = path.resolve('artifacts/phase2')
  fs.mkdirSync(root, { recursive: true })
  const temp = fs.mkdtempSync(path.join(root, 'r2-archive-test-'))
  try {
    assert.throws(
      () => pkgMac.packExistingMacPackage(temp, path.join(temp, 'out.zip')),
      /BUILD-PROVENANCE\.json|SOURCE-ARCHIVE\.json|MusicMeters\.app/
    )
  } finally {
    fs.rmSync(temp, { recursive: true, force: true })
  }
})

test('R3: macOS PRD and packaging docs never prescribe xattr -cr quarantine removal', () => {
  const prd = fs.readFileSync(path.resolve('docs/macos-port-prd.md'), 'utf8')
  assert.doesNotMatch(prd, /xattr\s+-cr/)
})

test('R4: macOS packaging rejects non-ad-hoc signing identities until full Developer ID hardened runtime signing is implemented', () => {
  const pkgMac = require('../../phase6/package-macos.cjs')
  assert.equal(typeof pkgMac.assertSupportedSignIdentity, 'function')
  assert.equal(pkgMac.assertSupportedSignIdentity('-'), '-')
  assert.throws(
    () => pkgMac.assertSupportedSignIdentity('Developer ID Application: Example Corp (TEAMID1234)'),
    /only ad-hoc signing|not yet configured/i
  )
})

test('R5 & R6: Darwin application menu and window reopen lifecycle match macOS platform conventions', () => {
  const darwinPlatform = require('../editor-app/darwin-platform.cjs')
  const dispatched = []
  let quitCalled = false
  let closeWindowCalled = false
  const template = darwinPlatform.buildDarwinMenuTemplate({
    appName: 'MusicMeters',
    onCommand: cmd => dispatched.push(cmd),
    onRequestQuit: () => { quitCalled = true },
    onRequestCloseWindow: () => { closeWindowCalled = true },
    onToggleFullScreen: () => dispatched.push('toggle-fullscreen'),
  })
  assert.deepEqual(
    template.map(section => section.label),
    ['MusicMeters', 'File', 'Edit', 'Templates', 'View', 'Window', 'Help']
  )
  const fileMenu = template.find(section => section.label === 'File').submenu
  const fileIds = fileMenu.filter(item => item.id).map(item => item.id)
  assert.deepEqual(fileIds, [
    'menu-new-blank',
    'menu-new-template',
    'menu-open-project',
    'menu-save-project',
    'menu-save-project-as',
    'menu-export',
    'menu-close-project',
  ])
  const editMenu = template.find(section => section.label === 'Edit').submenu
  const undoItem = editMenu.find(item => item.id === 'menu-undo')
  const redoItem = editMenu.find(item => item.id === 'menu-redo')
  assert.ok(undoItem && redoItem)
  undoItem.click()
  redoItem.click()
  assert.deepEqual(dispatched, ['undo', 'redo'])

  const templatesMenu = template.find(section => section.label === 'Templates').submenu
  assert.deepEqual(
    templatesMenu.filter(item => item.id).map(item => item.id),
    ['menu-use-template', 'menu-save-template', 'menu-manage-templates']
  )

  const helpMenu = template.find(section => section.label === 'Help').submenu
  helpMenu.find(item => item.id === 'menu-help-about').click()
  assert.ok(dispatched.includes('about'))

  const windowMenu = template.find(section => section.label === 'Window').submenu
  windowMenu.find(item => item.id === 'menu-close-window').click()
  assert.equal(closeWindowCalled, true)

  const appMenu = template.find(section => section.label === 'MusicMeters').submenu
  appMenu.find(item => item.id === 'menu-quit').click()
  assert.equal(quitCalled, true)

  assert.equal(
    darwinPlatform.shouldQuitOnWindowAllClosed({
      platform: 'darwin',
      quitRequested: false,
      isAutomatedTest: false,
      lifecycleSmoke: false,
    }),
    false
  )
  assert.equal(
    darwinPlatform.shouldQuitOnWindowAllClosed({
      platform: 'darwin',
      quitRequested: true,
      isAutomatedTest: false,
      lifecycleSmoke: false,
    }),
    true
  )
  assert.equal(
    darwinPlatform.shouldQuitOnWindowAllClosed({
      platform: 'win32',
      quitRequested: false,
      isAutomatedTest: false,
      lifecycleSmoke: false,
    }),
    true
  )

  assert.equal(
    darwinPlatform.initialScreenMode({
      isStartupSession: true,
      projectOpen: false,
      metadata: null,
      projectPath: null,
    }),
    'project-manager-splash'
  )
  assert.equal(
    darwinPlatform.initialScreenMode({
      isStartupSession: false,
      projectOpen: false,
      metadata: null,
      projectPath: null,
    }),
    'project-manager'
  )
  assert.equal(
    darwinPlatform.initialScreenMode({
      isStartupSession: false,
      projectOpen: true,
      metadata: { totalFrames: 300 },
      projectPath: null,
    }),
    'editor'
  )
})

test('R7: project thumbnail cache distinguishes case-distinct project paths on case-sensitive volumes', () => {
  const { readThumbnail, writeThumbnail, projectVersion } = require('../project-thumbnails.cjs')
  const pngA = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jf2kAAAAASUVORK5CYII='
  const pngB = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQYV2P4z8DwHwAFgwJ/l7zR+QAAAABJRU5ErkJggg=='
  const root = path.resolve('artifacts/phase2')
  fs.mkdirSync(root, { recursive: true })
  const temp = fs.mkdtempSync(path.join(root, 'r7-case-thumb-'))
  try {
    const profile = path.join(temp, 'profile')
    const fileA = path.join(temp, 'Mix', 'Demo.json')
    fs.mkdirSync(path.dirname(fileA), { recursive: true })
    fs.writeFileSync(fileA, '{"title":"SameBytes"}')
    const fileB = path.join(temp, 'mix', 'Demo.json')
    if (fs.existsSync(fileB) && fs.realpathSync.native(fileA) === fs.realpathSync.native(fileB)) {
      const origNative = fs.realpathSync.native
      const origRealpath = fs.realpathSync
      const fakeRealpath = Object.assign(p => path.resolve(p), { native: p => path.resolve(p) })
      fs.realpathSync = fakeRealpath
      try {
        const verA = projectVersion(fileA)
        const verB = projectVersion(fileB)
        assert.equal(writeThumbnail(profile, fileA, verA, pngA), true)
        assert.equal(writeThumbnail(profile, fileB, verB, pngB), true)
        assert.equal(readThumbnail(profile, fileA), pngA)
        assert.equal(readThumbnail(profile, fileB), pngB)
      } finally {
        fs.realpathSync = origRealpath
        fs.realpathSync.native = origNative
      }
    } else {
      fs.mkdirSync(path.dirname(fileB), { recursive: true })
      fs.writeFileSync(fileB, '{"title":"SameBytes"}')
      const statA = fs.statSync(fileA)
      fs.utimesSync(fileB, statA.atime, statA.mtime)
      const verA = projectVersion(fileA)
      const verB = projectVersion(fileB)
      assert.equal(writeThumbnail(profile, fileA, verA, pngA), true)
      assert.equal(writeThumbnail(profile, fileB, verB, pngB), true)
      assert.equal(readThumbnail(profile, fileA), pngA)
      assert.equal(readThumbnail(profile, fileB), pngB)
    }
  } finally {
    fs.rmSync(temp, { recursive: true, force: true })
  }
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

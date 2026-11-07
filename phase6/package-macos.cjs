const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { execFileSync, spawnSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const { build } = require('../phase2/build.cjs')
const { runtimeDirectory, expectedVersion } = require('./electron-runtime.cjs')
const identity = require('./application.cjs')
const { scanBinaryPrivacy } = require('./build-native.cjs')

const root = path.resolve(__dirname, '..')
const prism = path.join(root, 'upstream', 'prism')
const prismPin = '49721802252b115d169e353c98b27408daa5e2b7'
const PNG_MAGIC = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

const ICNS_TYPES_BY_SIZE = new Map([
  [16, 'icp4'],
  [32, 'icp5'],
  [64, 'icp6'],
  [128, 'ic07'],
  [256, 'ic08'],
  [512, 'ic09'],
  [1024, 'ic10'],
])

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function copyFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true })
  fs.copyFileSync(path.join(root, from), to)
}

function pngDimensions(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 24 || !buffer.subarray(0, 8).equals(PNG_MAGIC)) {
    return null
  }
  if (buffer.toString('ascii', 12, 16) !== 'IHDR') return null
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  }
}

function extractPngsFromIco(icoBuffer) {
  if (!Buffer.isBuffer(icoBuffer) || icoBuffer.length < 6) return []
  const reserved = icoBuffer.readUInt16LE(0)
  const type = icoBuffer.readUInt16LE(2)
  const count = icoBuffer.readUInt16LE(4)
  if (reserved !== 0 || type !== 1 || count < 1 || icoBuffer.length < 6 + count * 16) return []
  const pngs = []
  for (let i = 0; i < count; i++) {
    const entryOffset = 6 + i * 16
    const size = icoBuffer.readUInt32LE(entryOffset + 8)
    const offset = icoBuffer.readUInt32LE(entryOffset + 12)
    if (offset + size > icoBuffer.length || size < 24) continue
    const slice = icoBuffer.subarray(offset, offset + size)
    if (pngDimensions(slice)) pngs.push(Buffer.from(slice))
  }
  return pngs
}

function buildIcnsBuffer(pngBuffers) {
  const bySize = new Map()
  for (const buf of pngBuffers) {
    const dim = pngDimensions(buf)
    if (!dim || dim.width !== dim.height) continue
    const osType = ICNS_TYPES_BY_SIZE.get(dim.width)
    if (osType && !bySize.has(dim.width)) {
      bySize.set(dim.width, { osType, data: buf })
    }
  }
  if (bySize.size === 0) {
    throw new Error('At least one valid square PNG icon is required to build an .icns file')
  }
  const chunks = []
  let totalLength = 8
  for (const size of [...bySize.keys()].sort((a, b) => a - b)) {
    const { osType, data } = bySize.get(size)
    const chunkHeader = Buffer.alloc(8)
    chunkHeader.write(osType, 0, 4, 'ascii')
    chunkHeader.writeUInt32BE(8 + data.length, 4)
    chunks.push(chunkHeader, data)
    totalLength += 8 + data.length
  }
  const fileHeader = Buffer.alloc(8)
  fileHeader.write('icns', 0, 4, 'ascii')
  fileHeader.writeUInt32BE(totalLength, 4)
  return Buffer.concat([fileHeader, ...chunks])
}

function buildIcnsFromBrandAssets(brandDir = path.join(root, 'phase2', 'editor-app', 'assets', 'brand')) {
  const pngs = []
  for (const name of ['icon-32.png', 'icon-64.png']) {
    const candidate = path.join(brandDir, name)
    if (fs.existsSync(candidate)) pngs.push(fs.readFileSync(candidate))
  }
  const icoPath = path.join(brandDir, 'music-meters.ico')
  if (fs.existsSync(icoPath)) {
    pngs.push(...extractPngsFromIco(fs.readFileSync(icoPath)))
  }
  return buildIcnsBuffer(pngs)
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function buildInfoPlist(options = {}, baseXml = '') {
  const fields = {
    CFBundleDisplayName: options.displayName || identity.productName,
    CFBundleExecutable: options.executable || identity.macosExecutable || identity.productName,
    CFBundleIconFile: options.iconFile || identity.macosIconFile || 'music-meters.icns',
    CFBundleIdentifier: options.bundleId || identity.appId,
    CFBundleName: options.bundleName || identity.productName,
    CFBundlePackageType: 'APPL',
    CFBundleShortVersionString: options.version || identity.version,
    CFBundleVersion: options.buildVersion || options.version || identity.version,
    LSMinimumSystemVersion: options.minimumSystemVersion || identity.macosMinimumSystemVersion || '12.0',
    NSHighResolutionCapable: true,
    NSHumanReadableCopyright: options.copyright || identity.copyright || 'Copyright 2026 Vilohit Kale',
  }
  if (baseXml && baseXml.includes('<plist') && baseXml.includes('<dict>')) {
    let updated = baseXml
    for (const [key, val] of Object.entries(fields)) {
      if (typeof val === 'boolean') continue
      const escaped = escapeXml(val)
      const pattern = new RegExp(`(<key>${key}</key>\\s*<string>)[^<]*(</string>)`)
      if (pattern.test(updated)) {
        updated = updated.replace(pattern, `$1${escaped}$2`)
      } else {
        updated = updated.replace(/<\/dict>\s*<\/plist>\s*$/, `  <key>${key}</key>\n  <string>${escaped}</string>\n</dict>\n</plist>\n`)
      }
    }
    return updated
  }
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
  ]
  for (const [key, val] of Object.entries(fields)) {
    lines.push(`  <key>${escapeXml(key)}</key>`)
    if (typeof val === 'boolean') {
      lines.push(`  <${val ? 'true' : 'false'}/>`)
    } else {
      lines.push(`  <string>${escapeXml(val)}</string>`)
    }
  }
  lines.push('  <key>NSPrincipalClass</key>')
  lines.push('  <string>AtomApplication</string>')
  lines.push('  <key>NSSupportsAutomaticGraphicsSwitching</key>')
  lines.push('  <true/>')
  lines.push('</dict>')
  lines.push('</plist>')
  return lines.join('\n') + '\n'
}

function rebrandMacHelpers(bundleDir) {
  const frameworksDir = path.join(bundleDir, 'Contents', 'Frameworks')
  if (!fs.existsSync(frameworksDir)) return
  const suffixes = ['', ' (GPU)', ' (Plugin)', ' (Renderer)']
  for (const suffix of suffixes) {
    const oldHelperName = `Electron Helper${suffix}`
    const newHelperName = `${identity.productName} Helper${suffix}`
    const oldHelperBundle = path.join(frameworksDir, `${oldHelperName}.app`)
    if (!fs.existsSync(oldHelperBundle)) continue
    const oldExec = path.join(oldHelperBundle, 'Contents', 'MacOS', oldHelperName)
    const newExec = path.join(oldHelperBundle, 'Contents', 'MacOS', newHelperName)
    if (fs.existsSync(oldExec)) {
      fs.renameSync(oldExec, newExec)
      fs.chmodSync(newExec, 0o755)
    }
    const helperPlistPath = path.join(oldHelperBundle, 'Contents', 'Info.plist')
    if (fs.existsSync(helperPlistPath)) {
      const helperIdSuffix = suffix ? '.' + suffix.replace(/[() ]+/g, '').toLowerCase() : ''
      const baseXml = fs.readFileSync(helperPlistPath, 'utf8')
      const updatedXml = buildInfoPlist({
        displayName: newHelperName,
        executable: newHelperName,
        bundleName: newHelperName,
        bundleId: `${identity.appId}.helper${helperIdSuffix}`,
        version: identity.version,
      }, baseXml)
      fs.writeFileSync(helperPlistPath, updatedXml)
    }
    const newHelperBundle = path.join(frameworksDir, `${newHelperName}.app`)
    fs.renameSync(oldHelperBundle, newHelperBundle)
  }
}

function runCodesign(targetPath, signIdentity, extraArgs = []) {
  const result = spawnSync('codesign', ['--force', '--sign', signIdentity, ...extraArgs, targetPath], {
    encoding: 'utf8',
    shell: false,
  })
  if (result.status !== 0) {
    throw new Error(`codesign failed for ${targetPath}: ${result.stderr || result.error}`)
  }
}

function signMacBundle(bundleDir, signIdentity = process.env.MUSICMETERS_MACOS_SIGN_IDENTITY || '-') {
  const addon = path.join(bundleDir, 'Contents', 'Resources', 'app', 'upstream', 'prism', 'native', 'build', 'Release', 'visualizer_dsp.node')
  if (fs.existsSync(addon)) {
    runCodesign(addon, signIdentity)
  }
  const frameworksDir = path.join(bundleDir, 'Contents', 'Frameworks')
  if (fs.existsSync(frameworksDir)) {
    const librariesDir = path.join(frameworksDir, 'Electron Framework.framework', 'Versions', 'A', 'Libraries')
    if (fs.existsSync(librariesDir)) {
      for (const name of fs.readdirSync(librariesDir)) {
        if (name.endsWith('.dylib')) {
          runCodesign(path.join(librariesDir, name), signIdentity)
        }
      }
    }
    const crashpad = path.join(frameworksDir, 'Electron Framework.framework', 'Versions', 'A', 'Helpers', 'chrome_crashpad_handler')
    if (fs.existsSync(crashpad)) {
      runCodesign(crashpad, signIdentity)
    }
    for (const entry of fs.readdirSync(frameworksDir)) {
      if (entry.endsWith('.framework')) {
        runCodesign(path.join(frameworksDir, entry), signIdentity)
      }
    }
    for (const entry of fs.readdirSync(frameworksDir)) {
      if (entry.endsWith('.app')) {
        runCodesign(path.join(frameworksDir, entry), signIdentity)
      }
    }
  }
  runCodesign(bundleDir, signIdentity)
  const verify = spawnSync('codesign', ['--verify', '--deep', '--strict', bundleDir], {
    encoding: 'utf8',
    shell: false,
  })
  if (verify.status !== 0) {
    throw new Error(`codesign verification failed for ${bundleDir}: ${verify.stderr || verify.error}`)
  }
}

function parseArgs(argv) {
  let output = ''
  let zip = ''
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--output' && i + 1 < argv.length) {
      output = path.resolve(argv[++i])
    } else if (argv[i] === '--zip' && i + 1 < argv.length) {
      zip = path.resolve(argv[++i])
    } else {
      throw new Error('Usage on macOS: node phase6/package-macos.cjs --output <new-directory> [--zip <new-zip-path>]')
    }
  }
  if (!output) {
    throw new Error('Usage on macOS: node phase6/package-macos.cjs --output <new-directory> [--zip <new-zip-path>]')
  }
  return { output, zip }
}

async function main() {
  if (process.platform !== 'darwin') {
    throw new Error('Usage on macOS: node phase6/package-macos.cjs --output <new-directory> [--zip <new-zip-path>]')
  }
  const { output, zip } = parseArgs(process.argv.slice(2))
  if (fs.existsSync(output)) throw new Error(`Package output already exists: ${output}`)
  if (zip && fs.existsSync(zip)) throw new Error(`Archive output already exists: ${zip}`)

  await build()

  const sourceBundle = path.join(runtimeDirectory, 'Electron.app')
  if (!fs.existsSync(sourceBundle)) {
    throw new Error(`Locked macOS Electron.app runtime not found: ${sourceBundle}`)
  }
  const bundleDir = path.join(output, identity.macosBundleName)
  const resourcesDir = path.join(bundleDir, 'Contents', 'Resources')
  const app = path.join(resourcesDir, 'app')

  try {
    fs.mkdirSync(output, { recursive: true })
    fs.cpSync(sourceBundle, bundleDir, {
      recursive: true,
      errorOnExist: true,
      force: false,
      verbatimSymlinks: true,
    })

    for (const metaFile of ['version', 'LICENSE', 'LICENSES.chromium.html']) {
      const src = path.join(runtimeDirectory, metaFile)
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(output, metaFile))
        fs.copyFileSync(src, path.join(resourcesDir, metaFile))
      }
    }

    const oldExec = path.join(bundleDir, 'Contents', 'MacOS', 'Electron')
    const newExec = path.join(bundleDir, 'Contents', 'MacOS', identity.macosExecutable)
    if (fs.existsSync(oldExec)) {
      fs.renameSync(oldExec, newExec)
    }
    fs.chmodSync(newExec, 0o755)

    rebrandMacHelpers(bundleDir)

    const defaultAsar = path.join(resourcesDir, 'default_app.asar')
    if (fs.existsSync(defaultAsar)) fs.rmSync(defaultAsar, { force: true })
    const oldIcns = path.join(resourcesDir, 'electron.icns')
    if (fs.existsSync(oldIcns)) fs.rmSync(oldIcns, { force: true })

    const icnsBytes = buildIcnsFromBrandAssets()
    fs.writeFileSync(path.join(resourcesDir, identity.macosIconFile), icnsBytes)

    const plistPath = path.join(bundleDir, 'Contents', 'Info.plist')
    const basePlist = fs.existsSync(plistPath) ? fs.readFileSync(plistPath, 'utf8') : ''
    fs.writeFileSync(plistPath, buildInfoPlist({}, basePlist))
    const lint = spawnSync('plutil', ['-lint', plistPath], { encoding: 'utf8', shell: false })
    if (lint.status !== 0) {
      throw new Error(`Invalid Info.plist generated: ${lint.stderr || lint.stdout || lint.error}`)
    }

    fs.mkdirSync(app, { recursive: true })
    fs.writeFileSync(path.join(app, 'package.json'), JSON.stringify({
      name: identity.name, productName: identity.productName, version: identity.version,
      description: 'Offline music visualization and video export', author: 'MusicMeters',
      main: 'phase2/entry.cjs', private: true,
    }, null, 2) + '\n')

    copyFile('phase6/application.cjs', path.join(app, 'phase6', 'application.cjs'))
    for (const name of fs.readdirSync(path.join(root, 'phase2'))) {
      if (name.endsWith('.cjs') && !['build.cjs', 'run.cjs', 'export.cjs'].includes(name)) {
        copyFile(`phase2/${name}`, path.join(app, 'phase2', name))
      }
    }
    for (const name of fs.readdirSync(path.join(root, 'phase3'))) {
      if (name.endsWith('.cjs')) copyFile(`phase3/${name}`, path.join(app, 'phase3', name))
    }
    for (const from of [
      'phase1/pcm-reader.cjs',
      'phase2/editor-app/main.cjs', 'phase2/editor-app/preload.cjs',
      'phase2/editor-app/index.html', 'phase2/editor-app/style.css',
      'phase2/export-app/main.cjs', 'phase2/export-app/index.html',
      'phase2/export-app/style.css',
      'phase2/test/project-thumbnails-smoke.cjs',
      'phase2/test/video-transform-smoke.cjs',
      'phase2/test/export-range-smoke.cjs',
      'phase2/test/layer-snapping-smoke.cjs',
      'phase2/test/startup-smoke.cjs',
      'phase2/test/history-smoke.cjs',
      'phase2/test/project-manager-smoke.cjs',
      'phase2/test/portrait-smoke.cjs',
      'phase2/test/playback-smoke.cjs',
      'phase2/test/media-quality-smoke.cjs',
      'phase2/test/user-feedback-smoke.cjs',
      'phase2/test/media-storage-smoke.cjs',
      'phase2/test/meter-style-smoke.cjs',
      'phase6/test/repeat-smoke.cjs',
      'phase6/test/security-smoke.cjs',
      'phase6/test/audio-copy-editor-smoke.cjs',
      'phase6/test/preview-performance-smoke.cjs',
      'artifacts/phase2/editor.js', 'artifacts/phase2/export-renderer.js',
      'artifacts/phase2/vu-ballistics.cjs',
    ]) copyFile(from, path.join(app, from))

    for (const name of ['icon-32.png', 'icon-64.png', 'music-meters.ico']) {
      const from = `phase2/editor-app/assets/brand/${name}`
      copyFile(from, path.join(app, from))
    }

    const native = path.join(prism, 'native', 'build', 'Release', 'visualizer_dsp.node')
    scanBinaryPrivacy(native, [root, os.homedir()])
    const nativeTarget = path.join(app, 'upstream', 'prism', 'native', 'build', 'Release')
    fs.mkdirSync(nativeTarget, { recursive: true })
    fs.copyFileSync(native, path.join(nativeTarget, 'visualizer_dsp.node'))

    const noticePairs = [
      [path.join(prism, 'LICENSE'), 'PRISM-LICENSE.txt'],
      [path.join(prism, 'THIRD_PARTY_NOTICES.md'), 'PRISM-THIRD_PARTY_NOTICES.md'],
      [path.join(prism, 'native', 'vendor', 'REFERENCE_DEPENDENCIES.md'), 'PRISM-REFERENCE_DEPENDENCIES.md'],
      [path.join(prism, 'native', 'vendor', 'dr_libs', 'LICENSE'), 'DR_LIBS-LICENSE.txt'],
      [path.join(prism, 'native', 'vendor', 'r8brain', 'LICENSE'), 'R8BRAIN-LICENSE.txt'],
      [path.join(root, 'phase6', 'build-tools', 'node_modules', 'node-addon-api', 'LICENSE.md'), 'NODE-ADDON-API-LICENSE.md'],
      [path.join(root, 'LICENSE'), 'MUSICMETERS-LICENSE.txt'],
      [path.join(root, 'LICENSE-NOTICES.md'), 'LICENSE-NOTICES.md'],
      [path.join(root, 'phase6', 'THIRD_PARTY_NOTICES.md'), 'THIRD_PARTY_NOTICES.md'],
      [path.join(root, 'phase6', 'PORTABLE-README.md'), 'README.md'],
      [path.join(root, 'BUILD-CONFIGURATION.md'), 'BUILD-CONFIGURATION.md'],
    ]
    for (const [src, destName] of noticePairs) {
      fs.copyFileSync(src, path.join(output, destName))
      fs.copyFileSync(src, path.join(resourcesDir, destName))
    }

    const signIdentity = process.env.MUSICMETERS_MACOS_SIGN_IDENTITY || '-'
    signMacBundle(bundleDir, signIdentity)

    const sourceManifest = path.join(root, 'SOURCE-MANIFEST.json')
    const extracted = fs.existsSync(sourceManifest) ? JSON.parse(fs.readFileSync(sourceManifest, 'utf8')) : null
    const revision = extracted?.applicationRevision ||
      execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
    const trackedChanges = extracted ? false : Boolean(execFileSync('git',
      ['status', '--porcelain', '--untracked-files=no'], { cwd: root, encoding: 'utf8' }).trim())
    if (extracted && extracted.prismRevision !== prismPin) throw new Error('Extracted source Prism pin mismatch')
    const prismTrackedChanges = extracted ? false : Boolean(execFileSync('git',
      ['status', '--porcelain', '--untracked-files=no'], { cwd: prism, encoding: 'utf8' }).trim())

    const bundlePrefix = `${identity.macosBundleName}/Contents`
    const appFiles = [
      `${bundlePrefix}/MacOS/${identity.macosExecutable}`,
      `${bundlePrefix}/Info.plist`,
      `${bundlePrefix}/Resources/${identity.macosIconFile}`,
      `${bundlePrefix}/Resources/app/package.json`,
      `${bundlePrefix}/Resources/app/phase6/application.cjs`,
      `${bundlePrefix}/Resources/app/phase2/entry.cjs`,
      `${bundlePrefix}/Resources/app/phase2/editor-app/main.cjs`,
      'BUILD-CONFIGURATION.md',
      `${bundlePrefix}/Resources/app/upstream/prism/native/build/Release/visualizer_dsp.node`,
      `${bundlePrefix}/Resources/app/artifacts/phase2/editor.js`,
      `${bundlePrefix}/Resources/app/artifacts/phase2/export-renderer.js`,
      `${bundlePrefix}/Resources/app/artifacts/phase2/vu-ballistics.cjs`,
      'PRISM-THIRD_PARTY_NOTICES.md',
      'PRISM-REFERENCE_DEPENDENCIES.md',
      'DR_LIBS-LICENSE.txt',
      'R8BRAIN-LICENSE.txt',
    ]
    fs.writeFileSync(path.join(output, 'BUILD-PROVENANCE.json'), JSON.stringify({
      platform: 'darwin',
      arch: process.arch,
      minimumSystemVersion: identity.macosMinimumSystemVersion,
      signingMode: signIdentity === '-' ? 'adhoc' : 'identity',
      applicationRevision: revision,
      trackedChanges,
      prismTrackedChanges,
      prismRevision: prismPin,
      electronVersion: expectedVersion,
      applicationVersion: identity.version,
      executable: `${bundlePrefix}/MacOS/${identity.macosExecutable}`,
      appFileSha256: Object.fromEntries(appFiles.map(name => [name, sha256(path.join(output, name))])),
    }, null, 2) + '\n')

    if (zip) {
      fs.mkdirSync(path.dirname(zip), { recursive: true })
      const ditto = spawnSync('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', bundleDir, zip], {
        encoding: 'utf8',
        shell: false,
      })
      if (ditto.status !== 0) {
        throw new Error(`ditto failed creating ${zip}: ${ditto.stderr || ditto.error}`)
      }
    }

    console.log(JSON.stringify({
      output,
      bundle: bundleDir,
      executable: newExec,
      zip: zip || null,
      arch: process.arch,
      signingMode: signIdentity === '-' ? 'adhoc' : 'identity',
      ffmpeg: 'system PATH or Homebrew/MacPorts prerequisite',
      prismNative: nativeTarget,
    }))
  } catch (error) {
    fs.rmSync(output, { recursive: true, force: true })
    if (zip) fs.rmSync(zip, { force: true })
    throw error
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.message)
    process.exitCode = 1
  })
}

module.exports = {
  pngDimensions,
  extractPngsFromIco,
  buildIcnsBuffer,
  buildIcnsFromBrandAssets,
  buildInfoPlist,
  signMacBundle,
  main,
}

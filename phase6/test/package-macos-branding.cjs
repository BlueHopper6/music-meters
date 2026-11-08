const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { createHash } = require('node:crypto')
const { spawnSync } = require('node:child_process')
const identity = require('../application.cjs')
const { packagedBundleRoot, packagedExecutable, packagedAppRoot } = require('../packaged-executable.cjs')
const { buildIcnsFromBrandAssets } = require('../package-macos.cjs')
const { scanBinaryPrivacy } = require('../build-native.cjs')

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function compareVersions(left, right) {
  const a = left.split('.').map(Number)
  const b = right.split('.').map(Number)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const difference = (a[i] || 0) - (b[i] || 0)
    if (difference) return difference
  }
  return 0
}

function verifyMacBranding(directory) {
  const bundleDir = packagedBundleRoot(directory)
  const executable = packagedExecutable(directory)
  const appRoot = packagedAppRoot(directory)
  const resourcesDir = path.join(bundleDir, 'Contents', 'Resources')

  assert.ok(fs.existsSync(bundleDir) && fs.statSync(bundleDir).isDirectory(), `Missing .app bundle: ${bundleDir}`)
  assert.equal(fs.existsSync(path.join(bundleDir, 'Contents', 'MacOS', 'Electron')), false, 'Unbranded Electron binary must not remain')
  assert.ok(fs.existsSync(executable), `Missing branded executable: ${executable}`)
  const execStat = fs.statSync(executable)
  assert.ok((execStat.mode & 0o111) !== 0, 'Main macOS executable must have execute permissions')

  const frameworksDir = path.join(bundleDir, 'Contents', 'Frameworks')
  assert.equal(fs.existsSync(path.join(frameworksDir, 'Electron Helper.app')), false, 'Unbranded Electron Helper.app must not remain')
  const helperExec = path.join(frameworksDir, `${identity.productName} Helper.app`, 'Contents', 'MacOS', `${identity.productName} Helper`)
  assert.ok(fs.existsSync(helperExec), `Missing branded helper executable: ${helperExec}`)
  assert.ok((fs.statSync(helperExec).mode & 0o111) !== 0, 'Helper executable must have execute permissions')

  const frameworkRoot = path.join(frameworksDir, 'Electron Framework.framework')
  for (const relLink of ['Versions/Current', 'Electron Framework', 'Resources', 'Libraries', 'Helpers']) {
    const linkPath = path.join(frameworkRoot, relLink)
    if (fs.existsSync(linkPath)) {
      assert.equal(fs.lstatSync(linkPath).isSymbolicLink(), true, `Framework ${relLink} must remain a symbolic link`)
      const target = fs.readlinkSync(linkPath)
      assert.equal(path.posix.isAbsolute(target), false, `Framework ${relLink} symlink must be relative, got: ${target}`)
    }
  }

  assert.equal(fs.existsSync(path.join(resourcesDir, 'electron.icns')), false, 'Stock electron.icns must be removed')
  assert.equal(fs.existsSync(path.join(resourcesDir, 'default_app.asar')), false, 'Stock default_app.asar must be removed')

  const icnsPath = path.join(resourcesDir, identity.macosIconFile)
  assert.ok(fs.existsSync(icnsPath), `Missing bundle icon: ${icnsPath}`)
  const icnsBytes = fs.readFileSync(icnsPath)
  assert.equal(icnsBytes.toString('ascii', 0, 4), 'icns')
  assert.deepEqual(icnsBytes, buildIcnsFromBrandAssets(), 'Packaged .icns must match approved brand assets')

  const plistPath = path.join(bundleDir, 'Contents', 'Info.plist')
  assert.ok(fs.existsSync(plistPath), 'Missing Contents/Info.plist')
  const plistText = fs.readFileSync(plistPath, 'utf8')
  assert.match(plistText, new RegExp(`<key>CFBundleExecutable</key>\\s*<string>${identity.macosExecutable}</string>`))
  assert.match(plistText, new RegExp(`<key>CFBundleName</key>\\s*<string>${identity.productName}</string>`))
  assert.match(plistText, new RegExp(`<key>CFBundleDisplayName</key>\\s*<string>${identity.productName}</string>`))
  assert.match(plistText, new RegExp(`<key>CFBundleIdentifier</key>\\s*<string>${identity.appId}</string>`))
  assert.match(plistText, new RegExp(`<key>CFBundleIconFile</key>\\s*<string>${identity.macosIconFile}</string>`))
  assert.match(plistText, new RegExp(`<key>CFBundleShortVersionString</key>\\s*<string>${identity.version}</string>`))
  const minimumSystemVersion = plistText.match(/<key>LSMinimumSystemVersion<\/key>\s*<string>([^<]+)<\/string>/)?.[1]
  assert.equal(minimumSystemVersion, identity.macosMinimumSystemVersion, 'Bundle OS minimum must match application identity')

  const metadata = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8'))
  assert.equal(metadata.name, identity.name, 'Preserve original packaged profile identity')
  assert.equal(metadata.productName, identity.productName)
  assert.equal(metadata.version, identity.version)

  const addon = path.join(appRoot, 'upstream', 'prism', 'native', 'build', 'Release', 'visualizer_dsp.node')
  assert.ok(fs.existsSync(addon), 'Missing packaged Prism native addon')
  scanBinaryPrivacy(addon, [path.resolve(__dirname, '..', '..'), os.homedir()])

  const packageRoot = path.resolve(directory) === bundleDir ? path.dirname(bundleDir) : path.resolve(directory)
  const readmePath = path.join(packageRoot, 'README.md')
  assert.ok(fs.existsSync(readmePath), `Missing top-level macOS README.md: ${readmePath}`)
  const readmeText = fs.readFileSync(readmePath, 'utf8')
  assert.match(readmeText, /MusicMeters\.app/, 'macOS README.md must reference MusicMeters.app')
  assert.doesNotMatch(readmeText, /Run `MusicMeters\.exe`/, 'macOS README.md must not copy Windows MusicMeters.exe instructions')
  assert.doesNotMatch(readmeText, /xattr\s+-cr/, 'macOS README.md must not prescribe quarantine removal')

  const provenancePath = path.join(packageRoot, 'BUILD-PROVENANCE.json')
  assert.ok(fs.existsSync(provenancePath), `Missing BUILD-PROVENANCE.json: ${provenancePath}`)
  const provenance = JSON.parse(fs.readFileSync(provenancePath, 'utf8'))
  assert.equal(provenance.platform, 'darwin')
  assert.equal(provenance.signingMode, 'adhoc')
  for (const [relFile, expectedHash] of Object.entries(provenance.appFileSha256 || {})) {
    const fullPath = path.join(packageRoot, relFile)
    assert.ok(fs.existsSync(fullPath), `Missing provenance-tracked file: ${relFile}`)
    assert.equal(sha256(fullPath), expectedHash, `Provenance hash mismatch for ${relFile}`)
  }

  if (process.platform === 'darwin') {
    const lint = spawnSync('plutil', ['-lint', plistPath], { encoding: 'utf8', shell: false })
    assert.equal(lint.status, 0, `plutil failed: ${lint.stderr || lint.stdout}`)

    const verify = spawnSync('codesign', ['--verify', '--deep', '--strict', bundleDir], { encoding: 'utf8', shell: false })
    assert.equal(verify.status, 0, `codesign verify failed: ${verify.stderr}`)

    const expectedMachArch = process.arch === 'arm64' ? 'arm64' : 'x86_64'
    const frameworkExec = path.join(frameworkRoot, 'Electron Framework')
    for (const bin of [executable, frameworkExec, helperExec, addon]) {
      const fileOut = spawnSync('file', ['-b', bin], { encoding: 'utf8', shell: false })
      assert.equal(fileOut.status, 0)
      assert.match(fileOut.stdout, /Mach-O 64-bit/, `${bin} must be a 64-bit Mach-O binary: ${fileOut.stdout}`)
      assert.match(fileOut.stdout, new RegExp(expectedMachArch), `${bin} architecture mismatch: ${fileOut.stdout}`)

      const otool = spawnSync('otool', ['-L', bin], { encoding: 'utf8', shell: false })
      assert.equal(otool.status, 0)
      const linkedLibs = otool.stdout.trim().split(/\r?\n/).slice(1).join('\n')
      assert.doesNotMatch(linkedLibs, /\/Users\/|\/opt\/homebrew\/|\/usr\/local\//, `Mach-O binary links non-system path (${bin}): ${linkedLibs}`)

      const commands = spawnSync('otool', ['-l', bin], { encoding: 'utf8', shell: false })
      assert.equal(commands.status, 0, `Cannot inspect Mach-O OS requirement: ${commands.stderr}`)
      const binaryMinimum = commands.stdout.match(/cmd LC_BUILD_VERSION\s[\s\S]*?\bminos (\d+(?:\.\d+)*)/)?.[1]
        || commands.stdout.match(/cmd LC_VERSION_MIN_MACOSX\s[\s\S]*?\bversion (\d+(?:\.\d+)*)/)?.[1]
      assert.ok(binaryMinimum, `Missing Mach-O macOS requirement: ${bin}`)
      assert.ok(compareVersions(minimumSystemVersion, binaryMinimum) >= 0,
        `Bundle declares macOS ${minimumSystemVersion}, but ${path.basename(bin)} requires macOS ${binaryMinimum}`)
    }
  }

  console.log(JSON.stringify({
    event: 'package-macos-branding',
    status: 'PASS',
    bundle: identity.macosBundleName,
    executable: identity.macosExecutable,
    arch: process.arch,
    icon: identity.macosIconFile,
    profile: identity.name,
    minimumSystemVersion,
  }))
}

if (require.main === module) {
  if (process.argv.length !== 3) {
    throw new Error('Usage: node phase6/test/package-macos-branding.cjs <package-dir>')
  }
  verifyMacBranding(path.resolve(process.argv[2]))
}

module.exports = { verifyMacBranding }

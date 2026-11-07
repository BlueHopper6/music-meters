const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { spawnSync } = require('node:child_process')
const identity = require('../application.cjs')
const { packagedBundleRoot, packagedExecutable, packagedAppRoot } = require('../packaged-executable.cjs')
const { buildIcnsFromBrandAssets } = require('../package-macos.cjs')
const { scanBinaryPrivacy } = require('../build-native.cjs')

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

  const frameworkCurrent = path.join(frameworksDir, 'Electron Framework.framework', 'Versions', 'Current')
  if (fs.existsSync(frameworkCurrent)) {
    assert.equal(fs.lstatSync(frameworkCurrent).isSymbolicLink(), true, 'Framework Versions/Current must remain a relative symlink')
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

  const metadata = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8'))
  assert.equal(metadata.name, identity.name, 'Preserve original packaged profile identity')
  assert.equal(metadata.productName, identity.productName)
  assert.equal(metadata.version, identity.version)

  const addon = path.join(appRoot, 'upstream', 'prism', 'native', 'build', 'Release', 'visualizer_dsp.node')
  assert.ok(fs.existsSync(addon), 'Missing packaged Prism native addon')
  scanBinaryPrivacy(addon, [path.resolve(__dirname, '..', '..'), os.homedir()])

  if (process.platform === 'darwin') {
    const lint = spawnSync('plutil', ['-lint', plistPath], { encoding: 'utf8', shell: false })
    assert.equal(lint.status, 0, `plutil failed: ${lint.stderr || lint.stdout}`)

    const verify = spawnSync('codesign', ['--verify', '--deep', '--strict', bundleDir], { encoding: 'utf8', shell: false })
    assert.equal(verify.status, 0, `codesign verify failed: ${verify.stderr}`)

    const expectedMachArch = process.arch === 'arm64' ? 'arm64' : 'x86_64'
    for (const bin of [executable, addon]) {
      const fileOut = spawnSync('file', ['-b', bin], { encoding: 'utf8', shell: false })
      assert.equal(fileOut.status, 0)
      assert.match(fileOut.stdout, /Mach-O 64-bit/, `${bin} must be a 64-bit Mach-O binary: ${fileOut.stdout}`)
      assert.match(fileOut.stdout, new RegExp(expectedMachArch), `${bin} architecture mismatch: ${fileOut.stdout}`)
    }

    const otool = spawnSync('otool', ['-L', addon], { encoding: 'utf8', shell: false })
    assert.equal(otool.status, 0)
    assert.doesNotMatch(otool.stdout, /\/Users\/|\/opt\/homebrew\/|\/usr\/local\//, `Native addon links non-system path: ${otool.stdout}`)
  }

  console.log(JSON.stringify({
    event: 'package-macos-branding',
    status: 'PASS',
    bundle: identity.macosBundleName,
    executable: identity.macosExecutable,
    arch: process.arch,
    icon: identity.macosIconFile,
    profile: identity.name,
  }))
}

if (require.main === module) {
  if (process.argv.length !== 3) {
    throw new Error('Usage: node phase6/test/package-macos-branding.cjs <package-dir>')
  }
  verifyMacBranding(path.resolve(process.argv[2]))
}

module.exports = { verifyMacBranding }

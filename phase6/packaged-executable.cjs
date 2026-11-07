const fs = require('node:fs')
const path = require('node:path')
const { executable, macosExecutable, macosBundleName } = require('./application.cjs')

function isMacBundle(bundleDir) {
  return fs.existsSync(path.join(bundleDir, 'Contents', 'Info.plist'))
    || fs.existsSync(path.join(bundleDir, 'Contents', 'MacOS', macosExecutable))
}

function packagedBundleRoot(directory) {
  if (directory.endsWith('.app') && isMacBundle(directory)) {
    return directory
  }
  const nestedBundle = path.join(directory, macosBundleName)
  if (isMacBundle(nestedBundle)) {
    return nestedBundle
  }
  return directory
}

// Support Windows portable/installed directories as well as macOS .app bundles
// (passed either as the parent output directory or as MusicMeters.app directly).
function packagedExecutable(directory) {
  const branded = path.join(directory, executable)
  if (fs.existsSync(branded)) return branded
  const legacy = path.join(directory, 'electron.exe')
  if (fs.existsSync(legacy)) return legacy
  const directMac = path.join(directory, 'Contents', 'MacOS', macosExecutable)
  if (fs.existsSync(directMac)) return directMac
  const nestedMac = path.join(directory, macosBundleName, 'Contents', 'MacOS', macosExecutable)
  if (fs.existsSync(nestedMac)) return nestedMac
  throw new Error(`Packaged executable not found in ${directory}`)
}

function packagedAppRoot(directory) {
  const bundleRoot = packagedBundleRoot(directory)
  const macApp = path.join(bundleRoot, 'Contents', 'Resources', 'app')
  if (fs.existsSync(macApp)) return macApp
  return path.join(directory, 'resources', 'app')
}

module.exports = {
  packagedBundleRoot,
  packagedExecutable,
  packagedAppRoot,
}

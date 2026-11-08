const fs = require('node:fs')
const path = require('node:path')

const packageRoot = path.join(__dirname, 'electron-runtime')
const expectedVersion = require(path.join(packageRoot, 'package.json')).devDependencies.electron
const runtimeDirectory = path.join(packageRoot, 'node_modules', 'electron', 'dist')

function electronRelativeExecutable(platform = process.platform) {
  if (platform === 'win32') return 'electron.exe'
  if (platform === 'darwin') return path.join('Electron.app', 'Contents', 'MacOS', 'Electron')
  throw new Error(`Unsupported platform for Electron runtime: ${platform}`)
}

const electronExecutable = path.join(runtimeDirectory, electronRelativeExecutable())

function verifyElectronRuntime(platform = process.platform, distDir = runtimeDirectory) {
  const executablePath = path.join(distDir, electronRelativeExecutable(platform))
  const versionFile = path.join(distDir, 'version')
  if (!fs.existsSync(executablePath) || !fs.existsSync(versionFile)) {
    throw new Error(`Missing Electron ${expectedVersion} runtime. Run npm ci --ignore-scripts in ${packageRoot}, then node node_modules/electron/install.js there.`)
  }
  const actualVersion = fs.readFileSync(versionFile, 'utf8').trim()
  if (actualVersion !== expectedVersion) {
    throw new Error(`Electron runtime is ${actualVersion}; expected ${expectedVersion}`)
  }
  return executablePath
}

module.exports = {
  expectedVersion,
  runtimeDirectory,
  electronRelativeExecutable,
  electronExecutable,
  verifyElectronRuntime,
}

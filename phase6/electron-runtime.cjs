const fs = require('node:fs')
const path = require('node:path')

const packageRoot = path.join(__dirname, 'electron-runtime')
const expectedVersion = require(path.join(packageRoot, 'package.json')).devDependencies.electron
const runtimeDirectory = path.join(packageRoot, 'node_modules', 'electron', 'dist')
const electronExecutable = path.join(runtimeDirectory, 'electron.exe')

function verifyElectronRuntime() {
  const versionFile = path.join(runtimeDirectory, 'version')
  if (!fs.existsSync(electronExecutable) || !fs.existsSync(versionFile)) {
    throw new Error(`Missing Electron ${expectedVersion} runtime. Run npm ci --ignore-scripts in ${packageRoot}, then node node_modules/electron/install.js there.`)
  }
  const actualVersion = fs.readFileSync(versionFile, 'utf8').trim()
  if (actualVersion !== expectedVersion) {
    throw new Error(`Electron runtime is ${actualVersion}; expected ${expectedVersion}`)
  }
  return electronExecutable
}

module.exports = { expectedVersion, runtimeDirectory, electronExecutable, verifyElectronRuntime }

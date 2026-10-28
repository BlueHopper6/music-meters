const fs = require('node:fs')
const path = require('node:path')
const { executable } = require('./application.cjs')

// Also support historical portable packages in existing verification runners.
function packagedExecutable(directory) {
  const branded = path.join(directory, executable)
  if (fs.existsSync(branded)) return branded
  const legacy = path.join(directory, 'electron.exe')
  if (fs.existsSync(legacy)) return legacy
  throw new Error(`Packaged executable not found in ${directory}`)
}

module.exports = { packagedExecutable }

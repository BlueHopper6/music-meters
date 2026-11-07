const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

function realTempDir() {
  const raw = os.tmpdir()
  try {
    return fs.realpathSync(raw)
  } catch {
    return raw
  }
}

function tempRoot() {
  return path.join(realTempDir(), 'music-visualizer')
}

// Jobs must be writable when the application lives under a read-only install
// directory. Every job gets its own random leaf and is removed by its owner.
function jobPath(...parts) {
  return path.join(tempRoot(), ...parts)
}

module.exports = { realTempDir, tempRoot, jobPath }

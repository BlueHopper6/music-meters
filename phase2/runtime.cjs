const os = require('node:os')
const path = require('node:path')

// Jobs must be writable when the application lives under a read-only install
// directory. Every job gets its own random leaf and is removed by its owner.
function jobPath(...parts) {
  return path.join(os.tmpdir(), 'music-visualizer', ...parts)
}

module.exports = { jobPath }

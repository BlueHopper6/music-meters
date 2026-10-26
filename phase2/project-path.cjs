const path = require('node:path')

function encapsulateProjectPath(targetPath) {
  if (typeof targetPath !== 'string' || !targetPath.trim()) throw new Error('Invalid target path')
  const ext = path.extname(targetPath).toLowerCase()
  const resolved = path.resolve(targetPath.trim() + (ext !== '.json' ? '.json' : ''))
  const projectName = path.basename(resolved, '.json')
  const parentDir = path.dirname(resolved)
  if (path.basename(parentDir).toLowerCase() === projectName.toLowerCase()) {
    return resolved
  }
  return path.join(parentDir, projectName, `${projectName}.json`)
}

module.exports = { encapsulateProjectPath }

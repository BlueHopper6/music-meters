const path = require('node:path')

// Relative paths keep same-drive projects portable. A local drive path is needed
// when Windows cannot express a relative reference between different drives.
function resolveProjectAudio(projectFile, reference) {
  if (typeof reference !== 'string' || reference.length > 4096 || /[\u0000-\u001f]/.test(reference)) throw new Error('Invalid project audio reference')
  if (!reference) return ''
  const drivePath = /^[a-z]:[\\/]/i.test(reference)
  if (drivePath) {
    if (reference.slice(2).includes(':')) throw new Error('Invalid project audio reference')
  } else if (path.isAbsolute(reference) || path.win32.isAbsolute(reference) || reference.includes(':')) {
    throw new Error('Invalid project audio reference')
  }
  return path.resolve(path.dirname(projectFile), reference)
}

function projectAudioReference(projectFile, audio) {
  if (!audio) return ''
  const reference = path.relative(path.dirname(projectFile), audio).replaceAll('\\', '/')
  resolveProjectAudio(projectFile, reference)
  return reference
}

module.exports = { resolveProjectAudio, projectAudioReference }

const path = require('node:path')

function isMacVolumeReference(reference) {
  return /^\/Volumes\/[^/\\\u0000-\u001f]+\/[^\\\u0000-\u001f]+$/.test(reference)
    && !reference.includes('//')
    && !reference.split('/').includes('..')
    && !reference.includes(':')
}

function macVolumeRoot(inputPath) {
  const match = typeof inputPath === 'string' && inputPath.replaceAll('\\', '/').match(/^(\/Volumes\/[^/]+)(?:\/|$)/)
  return match ? match[1] : '/'
}

// Relative paths keep same-drive projects portable. A local drive path is needed
// when Windows cannot express a relative reference between different drives, and
// macOS external volumes under /Volumes/<Name>/... are supported explicitly.
function resolveProjectAudio(projectFile, reference) {
  if (typeof reference !== 'string' || reference.length > 4096 || /[\u0000-\u001f]/.test(reference)) throw new Error('Invalid project audio reference')
  if (!reference) return ''
  const drivePath = /^[a-z]:[\\/]/i.test(reference)
  if (drivePath) {
    if (reference.slice(2).includes(':')) throw new Error('Invalid project audio reference')
    if (process.platform !== 'win32') {
      return path.resolve(path.dirname(projectFile), '__windows_drive__', reference.replace(/^[a-z]:[\\/]+/i, '').replaceAll('\\', '/'))
    }
  } else if (isMacVolumeReference(reference)) {
    return process.platform === 'win32'
      ? path.resolve(path.dirname(projectFile), reference.slice(1))
      : path.posix.normalize(reference)
  } else if (path.isAbsolute(reference) || path.win32.isAbsolute(reference) || reference.includes(':')) {
    throw new Error('Invalid project audio reference')
  }
  return path.resolve(path.dirname(projectFile), reference)
}

function projectAudioReference(projectFile, audio) {
  if (!audio) return ''
  if (isMacVolumeReference(audio) && macVolumeRoot(projectFile) !== macVolumeRoot(audio)) {
    const normalized = path.posix.normalize(audio)
    resolveProjectAudio(projectFile, normalized)
    return normalized
  }
  const reference = path.relative(path.dirname(projectFile), audio).replaceAll('\\', '/')
  resolveProjectAudio(projectFile, reference)
  return reference
}

module.exports = { resolveProjectAudio, projectAudioReference, isMacVolumeReference }

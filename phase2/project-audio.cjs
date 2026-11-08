const path = require('node:path')

function isMacVolumeReference(reference) {
  return typeof reference === 'string'
    && /^\/Volumes\/[^/\\\u0000-\u001f]+\/[^\\\u0000-\u001f]+$/.test(reference)
    && !reference.includes('//')
    && !reference.split('/').includes('..')
    && !reference.split('/').includes('.')
    && !reference.includes(':')
}

function isWindowsDriveReference(reference) {
  if (typeof reference !== 'string' || !/^[a-z]:[\\/][^:*?"<>|\u0000-\u001f]+$/i.test(reference)) return false
  const rest = reference.slice(3).replaceAll('\\', '/')
  if (rest.includes('//') || rest.includes(':')) return false
  const parts = rest.split('/')
  return parts.every(part => part.length > 0 && part !== '.' && part !== '..')
}

function isForeignPlatformReference(reference, platform = process.platform) {
  if (typeof reference !== 'string' || !reference) return false
  return platform === 'win32'
    ? isMacVolumeReference(reference)
    : isWindowsDriveReference(reference)
}

function macVolumeRoot(inputPath) {
  const match = typeof inputPath === 'string' && inputPath.replaceAll('\\', '/').match(/^(\/Volumes\/[^/]+)(?:\/|$)/)
  return match ? match[1] : '/'
}

// Relative paths keep same-drive projects portable. A local drive path is needed
// when Windows cannot express a relative reference between different drives, and
// macOS external volumes under /Volumes/<Name>/... are supported explicitly.
// Foreign-platform references are preserved verbatim so cross-OS editing and saving
// never invent local paths or lose drive/volume identity.
function resolveProjectAudio(projectFile, reference) {
  if (typeof reference !== 'string' || reference.length > 4096 || /[\u0000-\u001f]/.test(reference)) throw new Error('Invalid project audio reference')
  if (!reference) return ''
  const drivePath = /^[a-z]:[\\/]/i.test(reference)
  if (drivePath) {
    if (!isWindowsDriveReference(reference)) throw new Error('Invalid project audio reference')
    if (process.platform !== 'win32') return reference
  } else if (isMacVolumeReference(reference)) {
    return process.platform === 'win32'
      ? reference
      : path.posix.normalize(reference)
  } else if (path.isAbsolute(reference) || path.win32.isAbsolute(reference) || reference.includes(':')) {
    throw new Error('Invalid project audio reference')
  }
  return path.resolve(path.dirname(projectFile), reference)
}

function projectAudioReference(projectFile, audio) {
  if (!audio) return ''
  if (isForeignPlatformReference(audio)) {
    resolveProjectAudio(projectFile, audio)
    return audio
  }
  if (isMacVolumeReference(audio) && macVolumeRoot(projectFile) !== macVolumeRoot(audio)) {
    const normalized = path.posix.normalize(audio)
    resolveProjectAudio(projectFile, normalized)
    return normalized
  }
  const reference = path.relative(path.dirname(projectFile), audio).replaceAll('\\', '/')
  resolveProjectAudio(projectFile, reference)
  return reference
}

module.exports = {
  resolveProjectAudio,
  projectAudioReference,
  isMacVolumeReference,
  isWindowsDriveReference,
  isForeignPlatformReference,
}

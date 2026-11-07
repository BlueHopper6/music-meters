const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const MACOS_FALLBACK_DIRS = Object.freeze([
  '/opt/homebrew/bin',
  '/usr/local/bin',
  '/opt/local/bin',
])

function isExecutableFile(candidate, platform = process.platform) {
  if (!candidate || typeof candidate !== 'string') return false
  try {
    const stat = fs.statSync(candidate)
    if (!stat.isFile()) return false
    if (platform !== 'win32') fs.accessSync(candidate, fs.constants.X_OK)
    return true
  } catch {
    return false
  }
}

function candidateNames(toolName, platform = process.platform) {
  if (platform === 'win32') {
    return toolName.toLowerCase().endsWith('.exe') ? [toolName] : [`${toolName}.exe`, toolName]
  }
  return [toolName]
}

/**
 * Resolves the executable path for a required media CLI tool (`ffmpeg` or `ffprobe`).
 * Checks explicit environment overrides first, then `PATH`, and on macOS falls back
 * to standard Homebrew/MacPorts locations (`/opt/homebrew/bin`, `/usr/local/bin`, `/opt/local/bin`)
 * so packaged Finder/Dock launches work even with a minimal GUI PATH.
 */
function resolveMediaTool(toolName, options = {}) {
  if (toolName !== 'ffmpeg' && toolName !== 'ffprobe') {
    throw new Error(`Unsupported media tool: ${toolName}`)
  }
  const platform = options.platform || process.platform
  const env = options.env || process.env
  const pathMod = platform === 'win32' ? path.win32 : path.posix
  const delimiter = platform === 'win32' ? ';' : ':'
  const checkFile = options.isExecutableFile || (candidate => isExecutableFile(candidate, platform))

  const envKey = toolName === 'ffmpeg' ? 'MUSICMETERS_FFMPEG_PATH' : 'MUSICMETERS_FFPROBE_PATH'
  const explicit = env[envKey]
  if (typeof explicit === 'string' && explicit.trim()) {
    const trimmed = explicit.trim()
    if (!checkFile(trimmed)) {
      throw new Error(`${envKey} does not point to an executable ${toolName} binary: ${trimmed}`)
    }
    return trimmed
  }

  const rawPath = env.PATH || env.Path || ''
  const pathDirs = rawPath.split(delimiter).map(entry => entry.trim()).filter(Boolean)
  const searchDirs = platform === 'darwin'
    ? [...pathDirs, ...(options.fallbackDirs || MACOS_FALLBACK_DIRS)]
    : pathDirs

  const seen = new Set()
  for (const dir of searchDirs) {
    if (seen.has(dir)) continue
    seen.add(dir)
    for (const name of candidateNames(toolName, platform)) {
      const candidate = pathMod.join(dir, name)
      if (checkFile(candidate)) return candidate
    }
  }

  return toolName
}

function ffmpegExecutable(options = {}) {
  return resolveMediaTool('ffmpeg', options)
}

function ffprobeExecutable(options = {}) {
  return resolveMediaTool('ffprobe', options)
}

function missingFfmpegMessage(toolName, platform = process.platform) {
  if (platform === 'darwin') {
    return `${toolName} is required but was not found. Install FFmpeg on macOS (for example: brew install ffmpeg) or ensure ffmpeg and ffprobe are in PATH.`
  }
  return `${toolName} is required but was not found. Install FFmpeg and ensure ffmpeg and ffprobe are in PATH.`
}

function verifyFfmpegInstallation(options = {}) {
  const platform = options.platform || process.platform
  const ffmpeg = ffmpegExecutable(options)
  const ffprobe = ffprobeExecutable(options)
  for (const [label, bin] of [['FFmpeg', ffmpeg], ['FFprobe', ffprobe]]) {
    try {
      execFileSync(bin, ['-version'], { stdio: 'ignore', windowsHide: true })
    } catch {
      throw new Error(missingFfmpegMessage(label, platform))
    }
  }
  return { ffmpeg, ffprobe }
}

module.exports = {
  MACOS_FALLBACK_DIRS,
  resolveMediaTool,
  ffmpegExecutable,
  ffprobeExecutable,
  missingFfmpegMessage,
  verifyFfmpegInstallation,
}

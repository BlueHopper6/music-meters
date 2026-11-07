const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { validFontFamily, fontFallbacksFor } = require('./project.cjs')

let cachedFonts

function cleanFontFamilyName(rawName) {
  if (typeof rawName !== 'string') return ''
  const trimmed = rawName.trim()
  if (!trimmed || trimmed.startsWith('.')) return ''
  return validFontFamily(trimmed) ? trimmed : ''
}

function parseMacOsSystemProfilerFonts(rawJson) {
  const data = JSON.parse(rawJson)
  const items = data?.SPFontsDataType
  if (!Array.isArray(items)) throw new Error('Installed font discovery returned an invalid list')
  const discovered = []
  for (const entry of items) {
    if (!entry || typeof entry !== 'object') continue
    if (entry.enabled === 'no' || entry.valid === 'no') continue
    const faces = Array.isArray(entry.typefaces) ? entry.typefaces : []
    let addedFace = false
    for (const face of faces) {
      if (!face || typeof face !== 'object') continue
      if (face.enabled === 'no' || face.valid === 'no') continue
      const family = cleanFontFamilyName(face.family)
      if (family) {
        discovered.push(family)
        addedFace = true
      }
    }
    if (!addedFace && typeof entry._name === 'string') {
      const stem = entry._name.replace(/\.(?:ttf|otf|ttc|dfont)$/i, '')
      const family = cleanFontFamilyName(stem)
      if (family) discovered.push(family)
    }
  }
  return [...new Set(discovered)].sort((a, b) => a.localeCompare(b))
}

function scanMacOsFontDirectories(directories = [
  '/System/Library/Fonts',
  '/System/Library/Fonts/Supplemental',
  '/Library/Fonts',
  path.join(os.homedir(), 'Library', 'Fonts'),
]) {
  const discovered = []
  for (const directory of directories) {
    if (!directory || !fs.existsSync(directory)) continue
    let entries
    try {
      if (fs.lstatSync(directory).isSymbolicLink()) continue
      entries = fs.readdirSync(directory, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isFile() || entry.isSymbolicLink()) continue
      if (!/\.(?:ttf|otf|ttc|dfont)$/i.test(entry.name)) continue
      const stem = entry.name
        .replace(/\.(?:ttf|otf|ttc|dfont)$/i, '')
        .replace(/[-_](?:Regular|Bold|Italic|BoldItalic|Light|Medium|Semibold|Black)$/i, '')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
      const family = cleanFontFamilyName(stem)
      if (family) discovered.push(family)
    }
  }
  return [...new Set(discovered)].sort((a, b) => a.localeCompare(b))
}

function discoverWindowsFonts() {
  const script = [
    '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
    'Add-Type -AssemblyName System.Drawing',
    '$collection = [System.Drawing.Text.InstalledFontCollection]::new()',
    'ConvertTo-Json -Compress -InputObject @($collection.Families | ForEach-Object Name)',
  ].join('; ')
  const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024, windowsHide: true,
  })
  const names = JSON.parse(output)
  if (!Array.isArray(names)) throw new Error('Installed font discovery returned an invalid list')
  return [...new Set(names.filter(validFontFamily))].sort((a, b) => a.localeCompare(b))
}

function discoverMacOsFonts() {
  const combined = new Set()
  try {
    const profilerBin = fs.existsSync('/usr/sbin/system_profiler') ? '/usr/sbin/system_profiler' : 'system_profiler'
    const output = execFileSync(profilerBin, ['SPFontsDataType', '-json'], {
      encoding: 'utf8', timeout: 15000, maxBuffer: 16 * 1024 * 1024,
    })
    for (const name of parseMacOsSystemProfilerFonts(output)) combined.add(name)
  } catch {
    // Fall back to bounded font directory scanning if system_profiler is unavailable or times out.
  }
  for (const name of scanMacOsFontDirectories()) combined.add(name)
  return [...combined].filter(validFontFamily).sort((a, b) => a.localeCompare(b))
}

function installedFonts(options = {}) {
  const platform = options.platform || process.platform
  if (!options.forceRefresh && platform === process.platform && cachedFonts) return cachedFonts
  let fonts
  if (platform === 'win32') {
    fonts = discoverWindowsFonts()
  } else if (platform === 'darwin') {
    fonts = discoverMacOsFonts()
  } else {
    throw new Error(`Installed font discovery is not supported on ${platform}`)
  }
  if (!fonts.length) throw new Error('No installed fonts were found')
  if (platform === process.platform && !options.forceRefresh) cachedFonts = fonts
  return fonts
}

function resolveFontFallback(fontFamily, fonts) {
  if (!validFontFamily(fontFamily)) return null
  const list = fonts || installedFonts()
  const byLower = new Map(list.map(name => [name.toLowerCase(), name]))
  const direct = byLower.get(fontFamily.toLowerCase())
  if (direct) return direct
  for (const candidate of fontFallbacksFor(fontFamily)) {
    const matched = byLower.get(candidate.toLowerCase())
    if (matched) return matched
  }
  return null
}

function assertInstalledFonts(project, fonts) {
  const textLayers = project.layers.filter(layer => layer.type === 'text')
  if (!textLayers.length) return
  const list = fonts || installedFonts()
  for (const layer of textLayers) {
    if (!resolveFontFallback(layer.fontFamily, list)) {
      throw new Error(`Font "${layer.fontFamily}" is not installed on this computer`)
    }
  }
}

module.exports = {
  installedFonts,
  assertInstalledFonts,
  resolveFontFallback,
  parseMacOsSystemProfilerFonts,
  scanMacOsFontDirectories,
}

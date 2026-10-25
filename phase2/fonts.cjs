const { execFileSync } = require('node:child_process')
const { validFontFamily } = require('./project.cjs')

let cachedFonts

function installedFonts() {
  if (cachedFonts) return cachedFonts
  if (process.platform !== 'win32') throw new Error('Installed font discovery currently requires Windows')
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
  cachedFonts = [...new Set(names.filter(validFontFamily))].sort((a, b) => a.localeCompare(b))
  if (!cachedFonts.length) throw new Error('No installed fonts were found')
  return cachedFonts
}

function assertInstalledFonts(project, fonts) {
  const textLayers = project.layers.filter(layer => layer.type === 'text')
  if (!textLayers.length) return
  const available = new Set((fonts || installedFonts()).map(name => name.toLowerCase()))
  for (const layer of textLayers) {
    if (!available.has(layer.fontFamily.toLowerCase())) {
      throw new Error(`Font "${layer.fontFamily}" is not installed on this computer`)
    }
  }
}

module.exports = { installedFonts, assertInstalledFonts }

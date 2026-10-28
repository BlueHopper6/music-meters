const fs = require('node:fs')
const path = require('node:path')
const { createRequire } = require('node:module')
const identity = require('./application.cjs')
const toolRequire = createRequire(path.join(__dirname, 'installer-tools', 'package.json'))

function brandExecutable(directory) {
  const ResEdit = toolRequire('resedit')
  const source = path.join(directory, 'electron.exe')
  const target = path.join(directory, identity.executable)
  // Rebranding invalidates Electron's signature. The resulting MusicMeters
  // application is unsigned until separately signed by its publisher.
  const exe = ResEdit.NtExecutable.from(fs.readFileSync(source), { ignoreCert: true })
  const resources = ResEdit.NtExecutableResource.from(exe)
  const icon = ResEdit.Data.IconFile.from(fs.readFileSync(path.join(__dirname,
    '..', 'phase2', 'editor-app', 'assets', 'brand', 'music-meters.ico')))
  for (const group of ResEdit.Resource.IconGroupEntry.fromEntries(resources.entries)) {
    ResEdit.Resource.IconGroupEntry.replaceIconsForResource(resources.entries,
      group.id, group.lang, icon.icons.map(item => item.data))
  }
  const versions = ResEdit.Resource.VersionInfo.fromEntries(resources.entries)
  if (!versions.length) throw new Error('Electron version resource not found')
  const [major, minor, patch] = identity.version.split('.').map(Number)
  for (const version of versions) {
    version.setFileVersion(major, minor, patch, 0)
    version.setProductVersion(major, minor, patch, 0)
    for (const language of version.getAllLanguagesForStringValues()) {
      version.setStringValues(language, {
        FileDescription: identity.productName, ProductName: identity.productName,
        InternalName: identity.productName, OriginalFilename: identity.executable,
        CompanyName: 'MusicMeters', LegalCopyright: 'Copyright 2026 Vilohit Kale',
      })
    }
    version.outputToResourceEntries(resources.entries)
  }
  resources.outputResource(exe)
  // Operate only on the fresh package's copies, never the cached runtime.
  fs.writeFileSync(source, Buffer.from(exe.generate()))
  fs.renameSync(source, target)
  const wer = path.join(directory, 'electron_wer.dll')
  if (fs.existsSync(wer)) fs.renameSync(wer, path.join(directory, 'MusicMeters_wer.dll'))
}

module.exports = { brandExecutable }

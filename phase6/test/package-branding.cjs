const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createRequire } = require('node:module')
const { createHash } = require('node:crypto')
const identity = require('../application.cjs')
const toolRequire = createRequire(path.join(__dirname, '..', 'installer-tools', 'package.json'))
const ResEdit = toolRequire('resedit')

function verifyBranding(directory) {
  const file = path.join(directory, identity.executable)
  // Parsing without ignoreCert also checks that no invalid Electron signature
  // was retained after resource editing. Release signing is a separate step.
  const exe = ResEdit.NtExecutable.from(fs.readFileSync(file))
  const resources = ResEdit.NtExecutableResource.from(exe)
  const versions = ResEdit.Resource.VersionInfo.fromEntries(resources.entries)
  assert.ok(versions.length)
  for (const version of versions) {
    for (const language of version.getAllLanguagesForStringValues()) {
      const strings = version.getStringValues(language)
      assert.equal(strings.ProductName, identity.productName)
      assert.equal(strings.FileDescription, identity.productName)
      assert.equal(strings.OriginalFilename, identity.executable)
      assert.equal(strings.ProductVersion, identity.version + '.0')
    }
  }
  const digest = item => createHash('sha256').update(Buffer.from(item.isRaw() ? item.bin : item.generate())).digest('hex')
  const icon = ResEdit.Data.IconFile.from(fs.readFileSync(path.join(__dirname,
    '..', '..', 'phase2', 'editor-app', 'assets', 'brand', 'music-meters.ico')))
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(resources.entries)
  assert.ok(groups.length)
  for (const group of groups) {
    assert.deepEqual(group.getIconItemsFromEntries(resources.entries).map(digest), icon.icons.map(item => digest(item.data)))
  }
  assert.equal(fs.existsSync(path.join(directory, 'electron.exe')), false)
  assert.ok(fs.existsSync(path.join(directory, 'MusicMeters_wer.dll')))
  const metadata = JSON.parse(fs.readFileSync(path.join(directory, 'resources', 'app', 'package.json')))
  assert.equal(metadata.name, identity.name, 'Preserve original packaged profile identity')
  assert.equal(metadata.productName, identity.productName)
  console.log(JSON.stringify({ event: 'package-branding', status: 'PASS', executable: identity.executable,
    icon: 'all image payloads match', profile: identity.name }))
}

if (process.argv.length !== 3) throw new Error('Usage: node phase6/test/package-branding.cjs <package-dir>')
verifyBranding(path.resolve(process.argv[2]))

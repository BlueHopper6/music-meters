const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { createRequire } = require('node:module')
const { execFileSync } = require('node:child_process')
const identity = require('./application.cjs')
const { expectedVersion } = require('./electron-runtime.cjs')
const root = path.resolve(__dirname, '..')
const toolRequire = createRequire(path.join(__dirname, 'installer-tools', 'package.json'))

const sha256 = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex')

function installerConfig(output) {
  return {
    appId: identity.appId, productName: identity.productName,
    electronVersion: expectedVersion, executableName: 'MusicMeters',
    directories: { output, buildResources: path.join(root, 'phase2', 'editor-app', 'assets', 'brand') },
    artifactName: 'MusicMeters-${version}-windows-x64-setup.${ext}',
    npmRebuild: false, publish: null,
    win: { target: [{ target: 'nsis', arch: ['x64'] }],
      icon: path.join(root, 'phase2', 'editor-app', 'assets', 'brand', 'music-meters.ico'),
      signAndEditExecutable: false },
    nsis: {
      oneClick: false, perMachine: false, allowElevation: false,
      allowToChangeInstallationDirectory: false,
      createStartMenuShortcut: true, shortcutName: identity.productName,
      createDesktopShortcut: false, uninstallDisplayName: identity.productName,
      deleteAppDataOnUninstall: false, runAfterFinish: false,
      differentialPackage: false,
      packElevateHelper: false,
      include: path.join(__dirname, 'installer.nsh'),
    },
  }
}

// Snapshot all files, rejecting links, so an installer can be traced to the
// exact portable tree and cannot silently package files outside that tree.
function packageFiles(directory, prefix = '') {
  const files = {}
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const name = prefix + entry.name
    const full = path.join(directory, entry.name)
    if (fs.lstatSync(full).isSymbolicLink()) throw new Error(`Package contains a link: ${name}`)
    if (entry.isDirectory()) Object.assign(files, packageFiles(full, name + '/'))
    else if (entry.isFile()) files[name] = sha256(full)
    else throw new Error(`Unsupported package entry: ${name}`)
  }
  return Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)))
}

async function main() {
  const args = process.argv.slice(2)
  const development = args.length === 5 && args[4] === '--development'
  if (process.platform !== 'win32' || (!development && args.length !== 4) ||
      args[0] !== '--package' || args[2] !== '--output') {
    throw new Error('Usage on Windows: node phase6/package-installer.cjs --package <portable-dir> --output <new-dir> [--development]')
  }
  const pack = fs.realpathSync(args[1])
  const output = path.resolve(args[3])
  if (fs.existsSync(output)) throw new Error(`Installer output already exists: ${output}`)
  const relative = path.relative(pack, output)
  if (!relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) {
    throw new Error('Installer output must be outside the portable package')
  }
  const provenance = JSON.parse(fs.readFileSync(path.join(pack, 'BUILD-PROVENANCE.json'), 'utf8'))
  if (provenance.executable !== identity.executable || provenance.applicationVersion !== identity.version ||
      provenance.electronVersion !== expectedVersion) throw new Error('Build a current branded portable package first')
  for (const [name, digest] of Object.entries(provenance.appFileSha256)) {
    if (sha256(path.join(pack, name)) !== digest) throw new Error(`Package file changed: ${name}`)
  }
  const descriptorPath = path.join(pack, 'SOURCE-ARCHIVE.json')
  if (!development && (provenance.trackedChanges || provenance.prismTrackedChanges || !fs.existsSync(descriptorPath))) {
    throw new Error('Release installer requires a clean package paired with source; use --development for local checks only')
  }
  if (!development) {
    const manifest = path.join(root, 'SOURCE-MANIFEST.json')
    const revision = fs.existsSync(manifest)
      ? JSON.parse(fs.readFileSync(manifest, 'utf8')).applicationRevision
      : execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
    const dirty = !fs.existsSync(manifest) && execFileSync('git',
      ['status', '--porcelain', '--untracked-files=no'], { cwd: root, encoding: 'utf8' }).trim()
    if (dirty || revision !== provenance.applicationRevision) {
      throw new Error('Installer build scripts must match the clean revision in the paired source archive')
    }
  }
  const source = fs.existsSync(descriptorPath) ? JSON.parse(fs.readFileSync(descriptorPath, 'utf8')) : null
  if (source && (source.applicationRevision !== provenance.applicationRevision || source.prismRevision !== provenance.prismRevision)) {
    throw new Error('Source descriptor does not match package provenance')
  }
  const before = packageFiles(pack)
  // Keep all builder downloads/cache files in this repository unless the caller
  // explicitly supplies another cache. No installer is launched here.
  process.env.ELECTRON_BUILDER_CACHE ||= path.join(root, 'artifacts', 'installer-cache')
  process.env.ELECTRON_BUILDER_COMPRESSION_LEVEL ||= '5'
  const { build } = toolRequire('electron-builder')
  const results = await build({ projectDir: path.join(pack, 'resources', 'app'),
    prepackaged: pack, config: installerConfig(output), publish: 'never' })
  if (JSON.stringify(packageFiles(pack)) !== JSON.stringify(before)) throw new Error('Builder modified the portable package')
  const installers = results.filter(file => file.endsWith('-setup.exe'))
  if (installers.length !== 1) throw new Error('Expected exactly one setup executable')
  fs.writeFileSync(path.join(output, 'INSTALLER-PROVENANCE.json'), JSON.stringify({
    development, applicationRevision: provenance.applicationRevision,
    applicationVersion: identity.version, appId: identity.appId,
    sourceArchive: source, portableFiles: before,
    installer: { filename: path.basename(installers[0]), sha256: sha256(installers[0]) },
  }, null, 2) + '\n')
  console.log(JSON.stringify({ installer: installers[0], development }))
}

if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1 })
module.exports = { installerConfig, packageFiles }

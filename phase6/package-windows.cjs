const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const { build } = require('../phase2/build.cjs')
const { runtimeDirectory } = require('./electron-runtime.cjs')

const root = path.resolve(__dirname, '..')
const prism = path.join(root, 'upstream', 'prism')
const prismPin = '49721802252b115d169e353c98b27408daa5e2b7'

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function copyFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true })
  fs.copyFileSync(path.join(root, from), to)
}

async function main() {
  if (process.platform !== 'win32' || process.argv.length !== 4 || process.argv[2] !== '--output') {
    throw new Error('Usage on Windows: node phase6/package-windows.cjs --output <new-directory>')
  }
  const output = path.resolve(process.argv[3])
  if (fs.existsSync(output)) throw new Error(`Package output already exists: ${output}`)
  // Build and validate the pinned local prerequisites before creating an output.
  await build()
  const runtime = runtimeDirectory
  const app = path.join(output, 'resources', 'app')
  try {
    fs.cpSync(runtime, output, { recursive: true, errorOnExist: true, force: false })
    fs.mkdirSync(app, { recursive: true })
    fs.writeFileSync(path.join(app, 'package.json'), JSON.stringify({
      name: 'music-visualizer', version: '0.6.0',
      main: 'phase2/entry.cjs', private: true,
    }, null, 2) + '\n')
    for (const name of fs.readdirSync(path.join(root, 'phase2'))) {
      if (name.endsWith('.cjs') && !['build.cjs', 'run.cjs', 'export.cjs'].includes(name)) {
        copyFile(`phase2/${name}`, path.join(app, 'phase2', name))
      }
    }
    for (const name of fs.readdirSync(path.join(root, 'phase3'))) {
      if (name.endsWith('.cjs')) copyFile(`phase3/${name}`, path.join(app, 'phase3', name))
    }
    for (const from of [
      'phase1/pcm-reader.cjs',
      'phase2/editor-app/main.cjs', 'phase2/editor-app/preload.cjs',
      'phase2/editor-app/index.html', 'phase2/editor-app/style.css',
      'phase2/export-app/main.cjs', 'phase2/export-app/index.html',
      'phase6/test/repeat-smoke.cjs',
      'phase6/test/preview-performance-smoke.cjs',
      'artifacts/phase2/editor.js', 'artifacts/phase2/export-renderer.js',
      'artifacts/phase2/vu-ballistics.cjs',
    ]) copyFile(from, path.join(app, from))
    for (const name of ['icon-32.png', 'icon-64.png', 'music-meters.ico']) {
      const from = `phase2/editor-app/assets/brand/${name}`
      copyFile(from, path.join(app, from))
    }
    const native = path.join(prism, 'native', 'build', 'Release', 'visualizer_dsp.node')
    const nativeTarget = path.join(app, 'upstream', 'prism', 'native', 'build', 'Release')
    fs.mkdirSync(nativeTarget, { recursive: true })
    fs.copyFileSync(native, path.join(nativeTarget, 'visualizer_dsp.node'))
    fs.copyFileSync(path.join(prism, 'LICENSE'), path.join(output, 'PRISM-LICENSE.txt'))
    fs.copyFileSync(path.join(prism, 'THIRD_PARTY_NOTICES.md'),
      path.join(output, 'PRISM-THIRD_PARTY_NOTICES.md'))
    fs.copyFileSync(path.join(prism, 'native', 'vendor', 'REFERENCE_DEPENDENCIES.md'),
      path.join(output, 'PRISM-REFERENCE_DEPENDENCIES.md'))
    fs.copyFileSync(path.join(prism, 'native', 'vendor', 'dr_libs', 'LICENSE'),
      path.join(output, 'DR_LIBS-LICENSE.txt'))
    fs.copyFileSync(path.join(prism, 'native', 'vendor', 'r8brain', 'LICENSE'),
      path.join(output, 'R8BRAIN-LICENSE.txt'))
    fs.copyFileSync(path.join(prism, 'node_modules', 'node-addon-api', 'LICENSE.md'),
      path.join(output, 'NODE-ADDON-API-LICENSE.md'))
    copyFile('LICENSE', path.join(output, 'MUSICMETERS-LICENSE.txt'))
    copyFile('LICENSE-NOTICES.md', path.join(output, 'LICENSE-NOTICES.md'))
    copyFile('phase6/THIRD_PARTY_NOTICES.md', path.join(output, 'THIRD_PARTY_NOTICES.md'))
    copyFile('phase6/PORTABLE-README.md', path.join(output, 'README.md'))
    const sourceManifest = path.join(root, 'SOURCE-MANIFEST.json')
    const extracted = fs.existsSync(sourceManifest) ? JSON.parse(fs.readFileSync(sourceManifest, 'utf8')) : null
    const revision = extracted?.applicationRevision ||
      execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
    const trackedChanges = extracted ? false : Boolean(execFileSync('git',
      ['status', '--porcelain', '--untracked-files=no'], { cwd: root, encoding: 'utf8' }).trim())
    if (extracted && extracted.prismRevision !== prismPin) throw new Error('Extracted source Prism pin mismatch')
    const prismTrackedChanges = extracted ? false : Boolean(execFileSync('git',
      ['status', '--porcelain', '--untracked-files=no'], { cwd: prism, encoding: 'utf8' }).trim())
    const appFiles = [
      'resources/app/upstream/prism/native/build/Release/visualizer_dsp.node',
      'resources/app/artifacts/phase2/editor.js',
      'resources/app/artifacts/phase2/export-renderer.js',
      'resources/app/artifacts/phase2/vu-ballistics.cjs',
      'PRISM-THIRD_PARTY_NOTICES.md',
      'PRISM-REFERENCE_DEPENDENCIES.md',
      'DR_LIBS-LICENSE.txt',
      'R8BRAIN-LICENSE.txt',
    ]
    fs.writeFileSync(path.join(output, 'BUILD-PROVENANCE.json'), JSON.stringify({
      applicationRevision: revision, trackedChanges,
      prismTrackedChanges,
      prismRevision: prismPin, electronVersion: require('./electron-runtime.cjs').expectedVersion,
      applicationVersion: '0.6.0',
      appFileSha256: Object.fromEntries(appFiles.map(name => [name, sha256(path.join(output, name))])),
    }, null, 2) + '\n')
    console.log(JSON.stringify({ output, executable: path.join(output, 'electron.exe'),
      ffmpeg: 'system PATH prerequisite', prismNative: nativeTarget }))
  } catch (error) {
    fs.rmSync(output, { recursive: true, force: true })
    throw error
  }
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1 })

module.exports = { main }

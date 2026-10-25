const fs = require('node:fs')
const path = require('node:path')
const { build } = require('../phase2/build.cjs')

const root = path.resolve(__dirname, '..')
const prism = path.join(root, 'upstream', 'prism')

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
  const runtime = path.join(prism, 'node_modules', 'electron', 'dist')
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
      'artifacts/phase2/editor.js', 'artifacts/phase2/export-renderer.js',
      'artifacts/phase2/vu-ballistics.cjs',
    ]) copyFile(from, path.join(app, from))
    const native = path.join(prism, 'native', 'build', 'Release', 'visualizer_dsp.node')
    const nativeTarget = path.join(app, 'upstream', 'prism', 'native', 'build', 'Release')
    fs.mkdirSync(nativeTarget, { recursive: true })
    fs.copyFileSync(native, path.join(nativeTarget, 'visualizer_dsp.node'))
    fs.copyFileSync(path.join(prism, 'LICENSE'), path.join(output, 'PRISM-LICENSE.txt'))
    copyFile('phase6/THIRD_PARTY_NOTICES.md', path.join(output, 'THIRD_PARTY_NOTICES.md'))
    copyFile('phase6/PORTABLE-README.md', path.join(output, 'README.md'))
    console.log(JSON.stringify({ output, executable: path.join(output, 'electron.exe'),
      ffmpeg: 'system PATH prerequisite', prismNative: nativeTarget }))
  } catch (error) {
    fs.rmSync(output, { recursive: true, force: true })
    throw error
  }
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1 })

module.exports = { main }

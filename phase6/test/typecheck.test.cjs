const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const ts = require('../build-tools/node_modules/typescript')

const configPath = path.resolve(__dirname, '..', 'tsconfig.json')
const config = ts.readConfigFile(configPath, ts.sys.readFile)
assert.equal(config.error, undefined)
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(configPath))
assert.deepEqual(parsed.errors, [])

function checkStyle(t, value) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'musicmeters-typecheck-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  // A contributor can already have a JS-only React package above the checkout.
  // Its exports must not shadow MusicMeters' locked, type-only dependency.
  const react = path.join(directory, 'node_modules', 'react')
  fs.mkdirSync(react, { recursive: true })
  fs.writeFileSync(path.join(react, 'package.json'), JSON.stringify({
    name: 'react', version: '18.3.1', exports: { '.': { default: './index.js' } },
  }))
  fs.writeFileSync(path.join(react, 'index.js'), 'module.exports = {}\n')
  const source = path.join(directory, 'app', 'style.ts')
  fs.mkdirSync(path.dirname(source))
  fs.writeFileSync(source, `import type { CSSProperties } from 'react'\nexport const style: CSSProperties = { position: ${value} }\n`)
  const program = ts.createProgram([source], parsed.options)
  return ts.getPreEmitDiagnostics(program)
}

test('strict typecheck uses locked React declarations despite an ancestor runtime package', t => {
  const diagnostics = checkStyle(t, "'absolute'")
  assert.deepEqual(diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), [])
})

test('strict typecheck still rejects invalid styles with an ancestor runtime package', t => {
  const diagnostics = checkStyle(t, '42')
  assert.deepEqual(diagnostics.map(d => d.code), [2322])
})

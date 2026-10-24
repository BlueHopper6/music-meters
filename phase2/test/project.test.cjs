const test = require('node:test')
const assert = require('node:assert/strict')
const { defaultProject, normalizeProject } = require('../project.cjs')

test('default project is a valid 16:9 composition with one real meter layer', () => {
  const project = normalizeProject(defaultProject())
  assert.equal(project.width / project.height, 16 / 9)
  assert.equal(project.fps, 30)
  assert.equal(project.layers.length, 1)
  assert.equal(project.layers[0].type, 'vectorscope')
})

test('rejects invalid geometry and duplicate layer IDs before saving or rendering', () => {
  const outside = defaultProject()
  outside.layers[0].x = 1000
  assert.throws(() => normalizeProject(outside), /outside the canvas/)
  const duplicate = defaultProject()
  duplicate.layers.push({ ...duplicate.layers[0] })
  assert.throws(() => normalizeProject(duplicate), /duplicate ID/)
})

test('rejects unsupported project versions and unsafe color values', () => {
  const old = defaultProject()
  old.version = 2
  assert.throws(() => normalizeProject(old), /Unsupported project version/)
  const badColor = defaultProject()
  badColor.layers[0].color = 'url(file:///secret)'
  assert.throws(() => normalizeProject(badColor), /hex color/)
})

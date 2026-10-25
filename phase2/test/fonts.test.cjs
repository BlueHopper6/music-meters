const test = require('node:test')
const assert = require('node:assert/strict')
const { compositionProject, textLayer, normalizeProject } = require('../project.cjs')
const { assertInstalledFonts } = require('../fonts.cjs')

test('installed font families beyond the original five survive project validation', () => {
  const project = compositionProject()
  project.layers = [textLayer('custom-font', 'Title', 'Example')]
  project.layers[0].fontFamily = 'Algerian'
  const normalized = normalizeProject(project)
  assert.equal(normalized.layers[0].fontFamily, 'Algerian')
  assert.doesNotThrow(() => assertInstalledFonts(normalized, ['Arial', 'Algerian']))
  assert.throws(() => assertInstalledFonts(normalized, ['Arial']), /not installed/)
})

test('font names cannot inject CSS syntax through project files', () => {
  for (const fontFamily of ['Bad" Font', 'Bad\\Font', 'Bad\nFont', '', 'A'.repeat(129)]) {
    const project = compositionProject()
    project.layers = [{ ...textLayer(), fontFamily }]
    assert.throws(() => normalizeProject(project), /Unsupported font/)
  }
})

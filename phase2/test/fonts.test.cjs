const test = require('node:test')
const assert = require('node:assert/strict')
const { compositionProject, textLayer, normalizeProject, canvasFontStack } = require('../project.cjs')
const { assertInstalledFonts, resolveFontFallback, parseMacOsSystemProfilerFonts } = require('../fonts.cjs')

test('installed font families beyond the original five survive project validation', () => {
  const project = compositionProject()
  project.layers = [textLayer('custom-font', 'Title', 'Example')]
  project.layers[0].fontFamily = 'Algerian'
  const normalized = normalizeProject(project)
  assert.equal(normalized.layers[0].fontFamily, 'Algerian')
  assert.doesNotThrow(() => assertInstalledFonts(normalized, ['Arial', 'Algerian']))
  assert.throws(() => assertInstalledFonts(normalized, ['Arial']), /not installed/)
})

test('cross-platform default font families resolve to installed equivalents without mutating project JSON', () => {
  const project = compositionProject()
  project.layers = [
    { ...textLayer('t1', 'Heading', 'Track'), fontFamily: 'Segoe UI' },
    { ...textLayer('t2', 'Timecode', '00:00'), fontFamily: 'Consolas' },
    { ...textLayer('t3', 'Badge', 'HQ'), fontFamily: 'Bahnschrift' },
  ]
  const normalized = normalizeProject(project)
  assert.equal(normalized.layers[0].fontFamily, 'Segoe UI')
  assert.equal(normalized.layers[1].fontFamily, 'Consolas')
  assert.equal(normalized.layers[2].fontFamily, 'Bahnschrift')
  const macFonts = ['Arial', 'Helvetica Neue', 'Menlo']
  assert.doesNotThrow(() => assertInstalledFonts(normalized, macFonts))
  assert.equal(resolveFontFallback('Segoe UI', macFonts), 'Helvetica Neue')
  assert.equal(resolveFontFallback('Consolas', macFonts), 'Menlo')
  assert.equal(resolveFontFallback('Bahnschrift', macFonts), 'Helvetica Neue')
  assert.equal(canvasFontStack('Consolas'), '"Consolas", "Menlo", "Monaco", "Courier New"')
})

test('macOS system_profiler font JSON is parsed and filtered safely', () => {
  const sample = JSON.stringify({
    SPFontsDataType: [
      {
        _name: 'HelveticaNeue.ttc',
        enabled: 'yes',
        valid: 'yes',
        typefaces: [
          { _name: 'HelveticaNeue', family: 'Helvetica Neue', enabled: 'yes', valid: 'yes' },
          { _name: '.SFNS-Regular', family: '.AppleSystemUIFont', enabled: 'yes', valid: 'yes' },
        ],
      },
      {
        _name: 'DisabledFont.ttf',
        enabled: 'no',
        valid: 'yes',
        typefaces: [{ _name: 'DisabledFont', family: 'Disabled Font', enabled: 'yes', valid: 'yes' }],
      },
    ],
  })
  assert.deepEqual(parseMacOsSystemProfilerFonts(sample), ['Helvetica Neue'])
})

test('font names cannot inject CSS syntax through project files', () => {
  for (const fontFamily of ['Bad" Font', 'Bad\\Font', 'Bad\nFont', '', 'A'.repeat(129)]) {
    const project = compositionProject()
    project.layers = [{ ...textLayer(), fontFamily }]
    assert.throws(() => normalizeProject(project), /Unsupported font/)
  }
})

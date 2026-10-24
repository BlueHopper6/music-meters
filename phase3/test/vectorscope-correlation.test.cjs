const test = require('node:test')
const assert = require('node:assert/strict')
const { vectorscopeCorrelations } = require('../vectorscope-correlation.cjs')

test('native point correlations identify in-phase, anti-phase, left-only, and silence', () => {
  const left = Float32Array.from({ length: 1024 }, (_, index) => Math.sin(index * 0.13))
  const opposite = Float32Array.from(left, value => -value)
  const silence = new Float32Array(left.length)
  assert.ok(vectorscopeCorrelations(left, left).overall > 0.999)
  assert.ok(vectorscopeCorrelations(opposite, left).overall < -0.999)
  assert.equal(vectorscopeCorrelations(silence, left).overall, 0)
  assert.equal(vectorscopeCorrelations(silence, silence).overall, 0)
})

test('each native multiband stereo pair has an independent correlation', () => {
  const bands = new Float32Array(6 * 1024)
  for (let index = 0; index < 1024; index++) {
    const signal = Math.sin(index * 0.13)
    bands.set([signal, signal, signal, -signal, signal, 0], index * 6)
  }
  const result = vectorscopeCorrelations(new Float32Array(0), new Float32Array(0), bands)
  assert.ok(result.bands[0] > 0.999)
  assert.ok(result.bands[1] < -0.999)
  assert.equal(result.bands[2], 0)
})

const test = require('node:test')
const assert = require('node:assert/strict')
const { circleArtwork } = require('../template-thumbnail.cjs')

test('sample artwork contains only a theme-colored SVG circle composition', () => {
  const svg = decodeURIComponent(circleArtwork('#ab1234').split(',')[1])
  assert.ok(svg.includes('<circle'))
  assert.ok(svg.includes('#ab1234'))
  assert.ok(!svg.includes('<text'))
  assert.ok(!svg.includes('polyline'))
  assert.ok(!svg.includes('<image'))
})

test('artwork rejects invalid colors instead of inserting markup', () => {
  for (const color of ['red', '#abc', '#ffffff"/><script>', undefined]) {
    assert.throws(() => circleArtwork(color), /Invalid artwork color/)
  }
})

test('glowing ring follows the artwork slot with a dark center', () => {
  const svg = decodeURIComponent(circleArtwork('#ab1234', 400, 500).split(',')[1])
  assert.ok(svg.includes('viewBox="0 0 400 500"'))
  assert.ok(svg.includes('cx="200" cy="250" r="128"'))
  assert.ok(svg.includes('width="512" height="640"'))
  assert.ok(svg.includes('feGaussianBlur'))
  assert.ok(!svg.includes('radialGradient'), 'Glow belongs to the ring, not the center')
  assert.equal((svg.match(/<circle /g) || []).length, 4)
  assert.ok(svg.includes('stroke-width="1.536"'), 'The sharp ring should be thin')
  for (const dimensions of [[0, 640], [640, NaN], [Infinity, 640], [640, 8193]]) {
    assert.throws(() => circleArtwork('#ab1234', ...dimensions), /Invalid artwork dimensions/)
  }
})

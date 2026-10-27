const test = require('node:test')
const assert = require('node:assert/strict')

test('portrait dragging, edge snapping and aspect resize use portrait bounds', () => {
  const { move, resize } = require('../stage-geometry.cjs')
  const box = { x: 30, y: 950, w: 200, h: 200 }
  assert.deepEqual(move(box, 1000, 1000, true, 0, 720, 1280), { x: 520, y: 1080, guideX: 720, guideY: 1280 })
  const sized = resize(box, 300, 300, 80, true, false, 0, 720, 1280)
  assert.equal(sized.w, 330)
  assert.equal(sized.h, 330)
})
const { move, resize } = require('../stage-geometry.cjs')

test('stage movement snaps edges and center with guide positions', () => {
  const box = { x: 100, y: 100, w: 200, h: 100 }
  assert.deepEqual(move(box, -96, -97, true), { x: 0, y: 0, guideX: 0, guideY: 0 })
  assert.deepEqual(move(box, 443, 207, true), { x: 540, y: 310, guideX: 640, guideY: 360 })
  assert.deepEqual(move(box, 977, 524, true), { x: 1080, y: 620, guideX: 1280, guideY: 720 })
  assert.deepEqual(move(box, 443, 207, false), { x: 543, y: 307, guideX: null, guideY: null })
})

test('grid increments are optional and resize snapping follows the dragged edges', () => {
  const box = { x: 96, y: 64, w: 200, h: 100 }
  assert.deepEqual(move(box, 19, 0, true, 32), { x: 120, y: 64, guideX: 320, guideY: 64 })
  assert.deepEqual(resize({ x: 300, y: 200, w: 330, h: 150 }, 8, 12, 80, false, true),
    { w: 340, h: 160, guideX: 640, guideY: 360 })
})

test('aspect lock preserves proportions under stage bounds and minimum size', () => {
  const square = { x: 900, y: 340, w: 200, h: 200 }
  assert.deepEqual(resize(square, 200, 0, 80, true), { w: 380, h: 380, guideX: null, guideY: null })
  assert.deepEqual(resize(square, -170, 0, 80, true), { w: 80, h: 80, guideX: null, guideY: null })
  const wide = resize({ x: 100, y: 100, w: 400, h: 200 }, 100, 0, 80, true)
  assert.deepEqual([wide.w, wide.h], [500, 250])
})

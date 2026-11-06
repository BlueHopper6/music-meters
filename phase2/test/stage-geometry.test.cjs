const test = require('node:test')
const assert = require('node:assert/strict')

test('portrait dragging, edge snapping and aspect resize use portrait bounds', () => {
  const { move, resize } = require('../stage-geometry.cjs')
  const box = { x: 30, y: 950, w: 200, h: 200 }
  assert.deepEqual(move(box, 1000, 1000, true, 0, 720, 1280), { x: 1030, y: 1950, guideX: null, guideY: null })
  const sized = resize(box, 300, 300, 80, true, false, 0, 720, 1280)
  assert.equal(sized.w, 500)
  assert.equal(sized.h, 500)
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

test('aspect lock preserves proportions and minimum size while crossing canvas edges', () => {
  const square = { x: 900, y: 340, w: 200, h: 200 }
  assert.deepEqual(resize(square, 200, 0, 80, true), { w: 400, h: 400, guideX: null, guideY: null })
  assert.deepEqual(resize(square, -170, 0, 80, true), { w: 80, h: 80, guideX: null, guideY: null })
  const wide = resize({ x: 100, y: 100, w: 400, h: 200 }, 100, 0, 80, true)
  assert.deepEqual([wide.w, wide.h], [500, 250])
})


test('dragging aligns adjacent and matching layer edges with guides', () => {
  const box = { id: 'moving', x: 100, y: 100, w: 100, h: 80 }
  const target = { id: 'target', x: 300, y: 250, w: 120, h: 80 }
  assert.deepEqual(move(box, 94, 147, true, 0, 1280, 720, [target]), { x: 200, y: 250, guideX: 300, guideY: 250, guideXIsLayer: true, guideYIsLayer: true })
  assert.equal(move(box, 317, 0, true, 0, 1280, 720, [target]).x, 420)
  assert.equal(move(box, 195, 0, true, 0, 1280, 720, [target]).x, 300)
  assert.equal(move(box, 0, 227, true, 0, 1280, 720, [target]).y, 330)
})

test('layer centers align independently on both axes', () => {
  const box = { x: 100, y: 100, w: 100, h: 80 }
  const target = { x: 300, y: 240, w: 200, h: 160 }
  assert.deepEqual(move(box, 244, 174, true, 0, 1280, 720, [target]), { x: 350, y: 280, guideX: 400, guideY: 320, guideXIsLayer: true, guideYIsLayer: true })
})

test('nearest layer/grid alignment wins and turning Snap off gives free movement', () => {
  const box = { x: 100, y: 100, w: 100, h: 80 }, target = { x: 330, y: 500, w: 180, h: 100 }
  assert.equal(move(box, 226, 0, true, 32, 1280, 720, [target]).x, 330)
  assert.equal(move(box, 221, 0, true, 32, 1280, 720, [target]).x, 320)
  assert.deepEqual(move(box, 226, 0, false, 32, 1280, 720, [target]), { x: 326, y: 100, guideX: null, guideY: null })
})

test('hidden, transparent and self layers are ignored; locked visible layers remain alignment targets', () => {
  const box = { id: 'moving', x: 100, y: 100, w: 100, h: 80 }
  const target = { x: 300, y: 250, w: 120, h: 80 }
  const skipped = [{ ...target, visible: false }, { ...target, opacity: 0 }, { ...target, id: 'moving' }]
  assert.deepEqual(move(box, 94, 147, true, 0, 1280, 720, skipped), { x: 194, y: 247, guideX: null, guideY: null })
  assert.equal(move(box, 94, 147, true, 0, 1280, 720, [{ ...target, locked: true }]).x, 200)
})

test('rotated layers snap their visible frame bounds instead of unrotated coordinates', () => {
  const target = { x: 300, y: 200, w: 200, h: 100, rotation: 90 }
  const box = { x: 100, y: 10, w: 100, h: 80 }
  assert.equal(move(box, 144, 0, true, 0, 1280, 720, [target]).x, 250)
  assert.equal(move({ ...box, rotation: 90 }, 155, 0, true, 0, 1280, 720, [target]).x, 260)
})

test('rotated layer alignment may cross the canvas edge', () => {
  const box = { x: 0, y: 20, w: 100, h: 80, rotation: 90 }
  const target = { x: 6, y: 500, w: 1000, h: 100 }
  assert.deepEqual(move(box, 0, 0, true, 0, 1280, 720, [target]), { x: -4, y: 20, guideX: 6, guideY: null, guideXIsLayer: true })
})


test('guide source distinguishes layer alignment from canvas and grid alignment', () => {
  const box = { x: 100, y: 100, w: 100, h: 80 }, target = { x: 330, y: 500, w: 180, h: 100 }
  assert.equal(move(box, 226, 0, true, 32, 1280, 720, [target]).guideXIsLayer, true)
  assert.equal(move(box, 221, 0, true, 32, 1280, 720, [target]).guideXIsLayer, undefined)
  assert.equal(move(box, -100, 0, true, 0, 1280, 720, [target]).guideXIsLayer, undefined)
})

test('layer snapping uses portrait canvas dimensions', () => {
  const box = { x: 40, y: 900, w: 100, h: 80 }, target = { x: 400, y: 1000, w: 120, h: 100 }
  const moved = move(box, 254, 94, true, 0, 720, 1280, [target])
  assert.deepEqual([moved.x, moved.y, moved.guideX, moved.guideY], [300, 1000, 400, 1000])
})


test('layers move beyond each canvas edge and retain a finite safety bound',()=>{
  const box={x:0,y:0,w:200,h:100}
  assert.deepEqual(move(box,-100,-50),{x:-100,y:-50,guideX:null,guideY:null})
  assert.deepEqual(move(box,1200,680),{x:1200,y:680,guideX:null,guideY:null})
  assert.deepEqual(move(box,-1e8,1e8),{x:-5120,y:2880,guideX:null,guideY:null})
  assert.deepEqual(resize({x:-100,y:-50,w:200,h:100},100,100,80),{w:300,h:200,guideX:null,guideY:null})
})

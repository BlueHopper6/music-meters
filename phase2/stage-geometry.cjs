const WIDTH = 1280
const HEIGHT = 720
const THRESHOLD = 8

function clamp(value, low, high) { return Math.max(low, Math.min(high, value)) }

function nearest(value, targets, grid, minimum = -Infinity, maximum = Infinity) {
  const choices = [...targets]
  if (grid > 0) choices.push(Math.round(value / grid) * grid)
  let result = { value, guide: null, distance: THRESHOLD + 1, targetIndex: -1 }
  for (const [targetIndex, target] of choices.entries()) {
    if (target < minimum || target > maximum) continue
    const distance = Math.abs(value - target)
    if (distance <= THRESHOLD && distance < result.distance) result = { value: target, guide: target, distance, targetIndex }
  }
  return result
}

// Axis-aligned outer bounds of the rotated layer frame, matching canvas transforms.
function bounds(box) {
  const angle = (box.rotation || 0) * Math.PI / 180
  const w = Math.abs(box.w * Math.cos(angle)) + Math.abs(box.h * Math.sin(angle))
  const h = Math.abs(box.w * Math.sin(angle)) + Math.abs(box.h * Math.cos(angle))
  return { left: box.x + (box.w - w) / 2, right: box.x + (box.w + w) / 2,
    top: box.y + (box.h - h) / 2, bottom: box.y + (box.h + h) / 2,
    centerX: box.x + box.w / 2, centerY: box.y + box.h / 2 }
}

/** @param {Array<{x:number,y:number,w:number,h:number,rotation?:number,visible?:boolean,opacity?:number,id?:string}>} [layers] */
function move(box, dx, dy, snapping = false, grid = 0, width = WIDTH, height = HEIGHT, layers = []) {
  let x = clamp(Math.round(box.x + dx), -width * 4, width * 4)
  let y = clamp(Math.round(box.y + dy), -height * 4, height * 4)
  let guideX = null
  let guideY = null
  let guideXIsLayer = false, guideYIsLayer = false
  if (snapping) {
    const edgesX = [], edgesY = [], centersX = [], centersY = []
    for (const other of layers) {
      if (other === box || box.id && other.id === box.id || other.visible === false || other.opacity <= 0) continue
      if (![other.x, other.y, other.w, other.h].every(Number.isFinite) || other.w <= 0 || other.h <= 0) continue
      const target = bounds(other)
      edgesX.push(target.left, target.right); edgesY.push(target.top, target.bottom)
      centersX.push(target.centerX); centersY.push(target.centerY)
    }
    const moving = bounds(box)
    const horizontal = [
      { offset: moving.left - box.x, targets: [0, ...edgesX] },
      { offset: box.w / 2, targets: [width / 2, ...centersX] },
      { offset: moving.right - box.x, targets: [width, ...edgesX] },
    ]
    const vertical = [
      { offset: moving.top - box.y, targets: [0, ...edgesY] },
      { offset: box.h / 2, targets: [height / 2, ...centersY] },
      { offset: moving.bottom - box.y, targets: [height, ...edgesY] },
    ]
    for (const [axis, anchors, extent] of [['x', horizontal, width], ['y', vertical, height]]) {
      const size = axis === 'x' ? box.w : box.h
      const current = axis === 'x' ? x : y
      let best = { distance: THRESHOLD + 1, value: current, guide: null, isLayer: false }
      for (const anchor of anchors) {
        const found = nearest(current + anchor.offset, anchor.targets, grid, -extent * 4 + anchor.offset, extent * 4 + anchor.offset)
        if (found.guide !== null && found.distance < best.distance) {
          best = { distance: found.distance, value: clamp(Math.round(found.value - anchor.offset), -extent * 4, extent * 4), guide: found.guide,
            isLayer: found.targetIndex > 0 && found.targetIndex < anchor.targets.length }
        }
      }
      if (axis === 'x') { x = best.value; guideX = best.guide; guideXIsLayer = best.isLayer }
      else { y = best.value; guideY = best.guide; guideYIsLayer = best.isLayer }
    }
  }
  return { x, y, guideX, guideY, ...(guideXIsLayer ? { guideXIsLayer: true } : {}), ...(guideYIsLayer ? { guideYIsLayer: true } : {}) }
}

function resize(box, dx, dy, minimum, aspectLocked = false, snapping = false, grid = 0, width = WIDTH, height = HEIGHT) {
  const maxW = width
  const maxH = height
  let w = clamp(Math.round(box.w + dx), minimum, maxW)
  let h = clamp(Math.round(box.h + dy), minimum, maxH)
  let guideX = null
  let guideY = null
  if (aspectLocked) {
    const dominant = Math.abs(dx / box.w) >= Math.abs(dy / box.h) ? 'x' : 'y'
    let scale = dominant === 'x' ? w / box.w : h / box.h
    if (snapping) {
      const edge = dominant === 'x' ? box.x + box.w * scale : box.y + box.h * scale
      const snapped = nearest(edge, dominant === 'x' ? [width / 2, width] : [height / 2, height], grid)
      if (snapped.guide !== null) {
        scale = (snapped.value - (dominant === 'x' ? box.x : box.y)) / (dominant === 'x' ? box.w : box.h)
        if (dominant === 'x') guideX = snapped.guide
        else guideY = snapped.guide
      }
    }
    scale = clamp(scale, Math.max(minimum / box.w, minimum / box.h), Math.min(maxW / box.w, maxH / box.h))
    w = Math.round(box.w * scale)
    h = Math.round(box.h * scale)
    if (guideX !== null && Math.abs(box.x + w - guideX) > 1) guideX = null
    if (guideY !== null && Math.abs(box.y + h - guideY) > 1) guideY = null
  } else if (snapping) {
    const right = nearest(box.x + w, [width / 2, width], grid)
    const bottom = nearest(box.y + h, [height / 2, height], grid)
    if (right.guide !== null && right.value - box.x >= minimum && right.value - box.x <= maxW) {
      w = right.value - box.x; guideX = right.guide
    }
    if (bottom.guide !== null && bottom.value - box.y >= minimum && bottom.value - box.y <= maxH) {
      h = bottom.value - box.y; guideY = bottom.guide
    }
  }
  return { w, h, guideX, guideY }
}

module.exports = { move, resize }

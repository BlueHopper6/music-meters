const WIDTH = 1280
const HEIGHT = 720
const THRESHOLD = 8

function clamp(value, low, high) { return Math.max(low, Math.min(high, value)) }

function nearest(value, targets, grid) {
  const choices = [...targets]
  if (grid > 0) choices.push(Math.round(value / grid) * grid)
  let result = { value, guide: null, distance: THRESHOLD + 1 }
  for (const target of choices) {
    const distance = Math.abs(value - target)
    if (distance <= THRESHOLD && distance < result.distance) result = { value: target, guide: target, distance }
  }
  return result
}

function move(box, dx, dy, snapping = false, grid = 0, width = WIDTH, height = HEIGHT) {
  let x = clamp(Math.round(box.x + dx), 0, width - box.w)
  let y = clamp(Math.round(box.y + dy), 0, height - box.h)
  let guideX = null
  let guideY = null
  if (snapping) {
    const horizontal = [
      { offset: 0, targets: [0] },
      { offset: box.w / 2, targets: [width / 2] },
      { offset: box.w, targets: [width] },
    ]
    const vertical = [
      { offset: 0, targets: [0] },
      { offset: box.h / 2, targets: [height / 2] },
      { offset: box.h, targets: [height] },
    ]
    for (const [axis, anchors, extent] of [['x', horizontal, width], ['y', vertical, height]]) {
      const size = axis === 'x' ? box.w : box.h
      const current = axis === 'x' ? x : y
      let best = { distance: THRESHOLD + 1, value: current, guide: null }
      for (const anchor of anchors) {
        const found = nearest(current + anchor.offset, anchor.targets, grid)
        if (found.guide !== null && found.distance < best.distance) {
          best = { distance: found.distance, value: clamp(Math.round(found.value - anchor.offset), 0, extent - size), guide: found.guide }
        }
      }
      if (axis === 'x') { x = best.value; guideX = best.guide }
      else { y = best.value; guideY = best.guide }
    }
  }
  return { x, y, guideX, guideY }
}

function resize(box, dx, dy, minimum, aspectLocked = false, snapping = false, grid = 0, width = WIDTH, height = HEIGHT) {
  const maxW = width - box.x
  const maxH = height - box.y
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
    if (right.guide !== null && right.value - box.x >= minimum && right.value <= width) {
      w = right.value - box.x; guideX = right.guide
    }
    if (bottom.guide !== null && bottom.value - box.y >= minimum && bottom.value <= height) {
      h = bottom.value - box.y; guideY = bottom.guide
    }
  }
  return { w, h, guideX, guideY }
}

module.exports = { move, resize }

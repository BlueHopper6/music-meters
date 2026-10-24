// Normalized stereo cross-correlation over Prism's most recent native vectorscope points.
// Silence or a missing channel has no defined phase relationship and displays 0.
function correlation(left, right, stride = 1, leftOffset = 0, rightOffset = 0) {
  const count = Math.min(Math.max(0, Math.floor((left.length - 1 - leftOffset) / stride) + 1),
    Math.max(0, Math.floor((right.length - 1 - rightOffset) / stride) + 1))
  let cross = 0, leftEnergy = 0, rightEnergy = 0
  for (let index = 0; index < count; index++) {
    const l = left[index * stride + leftOffset]
    const r = right[index * stride + rightOffset]
    if (!Number.isFinite(l) || !Number.isFinite(r)) continue
    cross += l * r
    leftEnergy += l * l
    rightEnergy += r * r
  }
  const denominator = Math.sqrt(leftEnergy * rightEnergy)
  return denominator > 1e-10 ? Math.max(-1, Math.min(1, cross / denominator)) : 0
}

function vectorscopeCorrelations(x, y, multiband) {
  const overall = correlation(y, x)
  if (!multiband || multiband.length < 6 || multiband.length % 6 !== 0) {
    return { overall, bands: null }
  }
  return { overall, bands: [
    correlation(multiband, multiband, 6, 0, 1),
    correlation(multiband, multiband, 6, 2, 3),
    correlation(multiband, multiband, 6, 4, 5),
  ] }
}

module.exports = { correlation, vectorscopeCorrelations }

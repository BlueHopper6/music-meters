// Render the gradient at its final pixel size and dither before 8-bit rounding.
// A fixed spatial pattern avoids flicker and keeps preview/export deterministic.
function gradientPixels(width, height, first, second, strength = 1.5) {
  const a = [1, 3, 5].map(offset => parseInt(first.slice(offset, offset + 2), 16))
  const b = [1, 3, 5].map(offset => parseInt(second.slice(offset, offset + 2), 16))
  const pixels = new Uint8ClampedArray(width * height * 4)
  const denominator = width * width + height * height
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let seed = Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263)
    seed = Math.imul(seed ^ seed >>> 13, 1274126177)
    const noise = (((seed >>> 0) / 4294967296) - 0.5) * strength * 2
    const t = ((x + 0.5) * width + (y + 0.5) * height) / denominator
    const offset = (y * width + x) * 4
    for (let channel = 0; channel < 3; channel++) pixels[offset + channel] = a[channel] + (b[channel] - a[channel]) * t + noise
    pixels[offset + 3] = 255
  }
  return pixels
}
module.exports = { gradientPixels }

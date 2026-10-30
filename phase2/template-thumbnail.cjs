// Only the artwork is SVG. The complete thumbnail is painted by Composition.
function circleArtwork(color, width = 640, height = 640) {
  if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error('Invalid artwork color')
  if (![width, height].every(value => Number.isFinite(value) && value > 0 && value <= 8192)) throw new Error('Invalid artwork dimensions')
  const radius = Math.min(width, height) * .32
  const scale = 640 / Math.max(width, height)
  const lighten = amount => '#' + [1, 3, 5].map(offset => {
    const channel = parseInt(color.slice(offset, offset + 2), 16)
    return Math.round(channel + (255 - channel) * amount).toString(16).padStart(2, '0')
  }).join('')
  const circle = (stroke, weight, opacity, filter = '') => `<circle cx="${width / 2}" cy="${height / 2}" r="${radius}" fill="none" stroke="url(#${stroke})" stroke-width="${weight}" opacity="${opacity}"${filter ? ` filter="url(#${filter})"` : ''}/>`
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.max(1, Math.round(width * scale))}" height="${Math.max(1, Math.round(height * scale))}" viewBox="0 0 ${width} ${height}">
    <defs>
      <linearGradient id="glow" x1="0" y1="1" x2="1" y2="0"><stop stop-color="${color}"/><stop offset="1" stop-color="${lighten(.55)}"/></linearGradient>
      <linearGradient id="ring" x1="0" y1="1" x2="1" y2="0"><stop stop-color="${lighten(.3)}"/><stop offset=".8" stop-color="${lighten(.8)}"/><stop offset="1" stop-color="${lighten(.5)}"/></linearGradient>
      <filter id="outer" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${radius * .095}"/></filter>
      <filter id="inner" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${radius * .045}"/></filter>
      <filter id="edge" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${radius * .012}"/></filter>
    </defs>
    <rect width="${width}" height="${height}" fill="#080f1f"/>
    ${circle('glow', radius * .14, .5, 'outer')}
    ${circle('glow', radius * .06, .8, 'inner')}
    ${circle('ring', radius * .025, .65, 'edge')}
    ${circle('ring', Math.max(1, radius * .012), 1)}
  </svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

module.exports = { circleArtwork }

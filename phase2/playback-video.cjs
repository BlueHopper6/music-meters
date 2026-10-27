const fs = require('node:fs')
const { Readable } = require('node:stream')

// Only the active audio file's randomly named capability is served. Renderer URLs never
// become filesystem paths. Range responses let Chromium seek without buffering
// an entire song in JavaScript memory.
function mediaResponse(request, media) {
  if (!media || request.url !== media.url) return new Response(null, { status: 404 })
  if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405 })
  const size = fs.statSync(media.path).size
  const headers = { 'Content-Type': media.type || 'video/mp4', 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' }
  let start = 0, end = size - 1, status = 200
  const range = request.headers.get('range')
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range)
    if (!match || (!match[1] && !match[2])) return new Response(null, { status: 416 })
    if (!match[1]) start = Math.max(0, size - Number(match[2]))
    else { start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])) }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
    }
    status = 206; headers['Content-Range'] = `bytes ${start}-${end}/${size}`
  }
  headers['Content-Length'] = String(end - start + 1)
  return new Response(request.method === 'HEAD' ? null : Readable.toWeb(fs.createReadStream(media.path, { start, end })), { status, headers })
}

module.exports = { mediaResponse }

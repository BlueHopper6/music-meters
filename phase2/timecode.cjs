function formatTimecode(seconds) {
  const total = Math.max(0, Math.round((Number.isFinite(seconds) ? seconds : 0) * 1000))
  const hours = Math.floor(total / 3600000)
  const minutes = Math.floor(total / 60000) % 60
  const rest = Math.floor(total / 1000) % 60
  const pad = value => String(value).padStart(2, '0')
  return `${hours ? `${pad(hours)}:` : ''}${pad(minutes)}:${pad(rest)}.${String(total % 1000).padStart(3, '0')}`
}
function parseTimecode(value) {
  const parts = String(value).trim().split(':')
  if (parts.length > 3 || parts.some((part, index) => !(index === parts.length - 1 ? /^\d+(?:\.\d+)?$/ : /^\d+$/).test(part))) return null
  const numbers = parts.map(Number)
  if (numbers.some(number => !Number.isFinite(number))) return null
  if (parts.length > 1 && numbers.at(-1) >= 60) return null
  if (parts.length === 3 && numbers[1] >= 60) return null
  const seconds = numbers.reduce((total, number) => total * 60 + number, 0)
  return Number.isFinite(seconds) ? seconds : null
}
// Chromium media timestamps can round a frame boundary down by a fraction of
// a microsecond. Keep keyboard frame steps from snapping back to the old frame.
function frameAtTime(seconds) { return Math.max(0, Math.floor(seconds * 30 + 0.0001)) }
module.exports = { formatTimecode, parseTimecode, frameAtTime }

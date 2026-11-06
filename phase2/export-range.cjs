// Export boundaries follow the composition's 30 FPS clock. Source files stay intact.
function exportRange(value, duration) {
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('Project duration is unavailable')
  if (value === undefined || value === null) return { start: 0, end: duration, duration, partial: false }
  if (typeof value !== 'object' || Array.isArray(value)
      || !Number.isFinite(value.start) || !Number.isFinite(value.end)
      || value.start < 0 || value.end > duration + 1e-7 || value.end <= value.start) {
    throw new Error('Choose an export start and end within the project, with end after start.')
  }
  const start = Math.round(value.start * 30) / 30
  const end = Math.abs(value.end - duration) < 1e-7 ? duration : Math.min(duration, Math.round(value.end * 30) / 30)
  if (start >= end) throw new Error('The export range must contain at least one video frame.')
  return { start, end, duration: end - start, partial: start > 0 || end < duration - 1e-7 }
}
function assertRangeAudioMode(range, mode) {
  if (range.partial && mode === 'copy') throw new Error('A selected range needs encoded audio for accurate cuts. Choose MP4 AAC, lossless FLAC, or the float PCM master.')
}
module.exports = { exportRange, assertRangeAudioMode }

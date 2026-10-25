const fs = require('node:fs')
const path = require('node:path')

const MIB = 1024n * 1024n

// A CRF encoder has no fixed output size. Reserve a conservative working
// estimate before doing CPU-heavy analysis; ENOSPC during encoding is still
// handled by the export cleanup path.
function assertOutputSpace(output, duration, statfs = fs.statfsSync) {
  let directory = path.dirname(output)
  while (!fs.existsSync(directory)) {
    const parent = path.dirname(directory)
    if (parent === directory) throw new Error('Output directory is unavailable')
    directory = parent
  }
  const volume = statfs(directory, { bigint: true })
  const available = BigInt(volume.bavail) * BigInt(volume.bsize)
  const estimated = 32n * MIB + BigInt(Math.ceil(duration * 1.5 * Number(MIB)))
  if (available < estimated) {
    throw new Error(`Insufficient disk space for export: about ${Math.ceil(Number(estimated) / Number(MIB))} MiB is needed on the output drive`)
  }
  return { availableBytes: available, estimatedBytes: estimated }
}

module.exports = { assertOutputSpace }

const fs = require('node:fs')
const path = require('node:path')

function validateStillOutput(output) {
  if (typeof output !== 'string' || !path.isAbsolute(output) || path.extname(output).toLowerCase() !== '.png') {
    throw new Error('Choose a local PNG image destination.')
  }
}
function validateStillFrame(frame, metadata) {
  if (!Number.isSafeInteger(frame) || frame < 0 || frame >= (metadata?.totalFrames || 1)) throw new Error('Still frame is outside the project.')
}
// Exclusive creation also protects against a destination appearing after the picker.
function writeStill(output, png) {
  validateStillOutput(output)
  let fd
  try { fd = fs.openSync(output, 'wx'); fs.writeFileSync(fd, png) }
  catch (error) { if (fd !== undefined) { fs.closeSync(fd); fd = undefined; fs.unlinkSync(output) } throw error }
  finally { if (fd !== undefined) fs.closeSync(fd) }
}
module.exports = { validateStillOutput, validateStillFrame, writeStill }

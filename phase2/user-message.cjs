// Electron wraps rejected IPC calls with transport details; keep those out of user-facing copy.
function userMessage(error, platform = typeof process !== 'undefined' ? process.platform : 'win32') {
  let message = error && typeof error.message === 'string' ? error.message : String(error ?? '')
  message = message.replace(/(?:Error:\s*)?Error invoking remote method ['"][^'"]+['"]:\s*(?:Error:\s*)?/g, '')
    .replace(/^(?:Error:\s*)+/, '').trim()
  if (/\bENOENT:/.test(message)) return 'This file or folder could not be found. Check that the drive is connected and the location still exists.'
  if (/\b(?:EACCES|EPERM):/.test(message)) {
    const osName = platform === 'darwin' ? 'macOS' : 'Windows'
    return `${osName} blocked access to this file or folder. Check its permissions or choose another location.`
  }
  if (/\bENOSPC:/.test(message)) return 'There is not enough free disk space. Free some space or choose another drive.'
  return message || 'Something went wrong. Please try again.'
}
function isQuietCancellation(error) {
  return /^(?:Media preparation cancelled|Preview superseded|Preview cancelled|Export cancelled)[.!]?$/.test(userMessage(error))
}
module.exports = { userMessage, isQuietCancellation }

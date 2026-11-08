const test = require('node:test'), assert = require('node:assert/strict')
const { userMessage, isQuietCancellation } = require('../user-message.cjs')
test('user-facing failures remove Electron IPC wrappers and repeated Error prefixes', () => {
  assert.equal(userMessage(new Error("Error invoking remote method 'choose-image': Error: Artwork must be under 8 MB")), 'Artwork must be under 8 MB')
  assert.equal(userMessage("Error: Error invoking remote method 'save-project': Error: Disk is read-only"), 'Disk is read-only')
  assert.equal(userMessage('Save failed: Error invoking remote method "save-project": Error: Cannot save'), 'Save failed: Cannot save')
  assert.equal(userMessage('Real Prism meter still at 0.00 s.'), 'Real Prism meter still at 0.00 s.')
  assert.equal(userMessage(new Error('Video preview load timed out')), 'Video preview load timed out')
  assert.equal(userMessage(null), 'Something went wrong. Please try again.')
})
test('filesystem failures give actionable drive, access and disk-space guidance', () => {
  assert.match(userMessage(new Error('ENOENT: no such file or directory')), /drive is connected/)
  for (const code of ['EACCES', 'EPERM']) {
    assert.match(userMessage(code + ': access denied'), /(?:Windows|macOS) blocked access/)
    assert.match(userMessage(code + ': access denied', 'win32'), /Windows blocked access/)
    assert.match(userMessage(code + ': access denied', 'darwin'), /macOS blocked access/)
  }
  assert.match(userMessage('ENOSPC: no space left on device'), /another drive/)
})


test('expected cancellations stay quiet without hiding unrelated file failures', () => {
  assert.equal(isQuietCancellation(new Error("Error invoking remote method 'load-videos': Error: Media preparation cancelled")), true)
  assert.equal(isQuietCancellation('Preview superseded'), true)
  assert.equal(isQuietCancellation('Cannot read Media preparation cancelled.png'), false)
  assert.equal(isQuietCancellation('Video preview load timed out'), false)
})

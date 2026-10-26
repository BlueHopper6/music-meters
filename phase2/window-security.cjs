const { pathToFileURL } = require('node:url')

function lockWindowNavigation(contents) {
  contents.on('will-navigate', event => event.preventDefault())
  contents.on('will-frame-navigate', event => event.preventDefault())
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
}

function assertTrustedSender(event, contents, documentPath) {
  const expectedUrl = pathToFileURL(documentPath).href
  if (!contents || contents.isDestroyed() || event.sender !== contents ||
      !event.senderFrame || event.senderFrame !== contents.mainFrame ||
      event.senderFrame.url !== expectedUrl) {
    throw new Error('Untrusted IPC sender')
  }
}

module.exports = { lockWindowNavigation, assertTrustedSender }

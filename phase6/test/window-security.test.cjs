const test = require('node:test')
const assert = require('node:assert/strict')
const { pathToFileURL } = require('node:url')
const { lockWindowNavigation, assertTrustedSender } = require('../../phase2/window-security.cjs')

test('window rejects renderer navigation and child windows', () => {
  const listeners = new Map()
  let openHandler
  lockWindowNavigation({
    on: (name, listener) => listeners.set(name, listener),
    setWindowOpenHandler: handler => { openHandler = handler },
  })
  for (const name of ['will-navigate', 'will-frame-navigate']) {
    let prevented = false
    listeners.get(name)({ preventDefault: () => { prevented = true } })
    assert.equal(prevented, true)
  }
  assert.deepEqual(openHandler({ url: 'https://example.com' }), { action: 'deny' })
})

test('IPC accepts only the editor main frame at its exact local document', () => {
  const documentPath = 'C:\\app\\editor\\index.html'
  const mainFrame = { url: pathToFileURL(documentPath).href }
  const contents = { mainFrame, isDestroyed: () => false }
  const event = { sender: contents, senderFrame: mainFrame }
  assert.doesNotThrow(() => assertTrustedSender(event, contents, documentPath))
  for (const bad of [
    { ...event, sender: {} },
    { ...event, senderFrame: { url: mainFrame.url } },
    { ...event, senderFrame: { url: 'https://example.com' } },
    { ...event, senderFrame: null },
  ]) assert.throws(() => assertTrustedSender(bad, contents, documentPath), /Untrusted IPC sender/)
  assert.throws(() => assertTrustedSender(event, { ...contents, isDestroyed: () => true }, documentPath), /Untrusted IPC sender/)
})

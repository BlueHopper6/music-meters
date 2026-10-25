const assert = require('node:assert/strict')
const { app } = require('electron')

module.exports = async function securitySmoke(win) {
  const contents = win.webContents
  const originalUrl = contents.getURL()
  const initial = await contents.executeJavaScript('window.desktop.initial()')
  assert.ok(initial.project)
  assert.equal(await contents.executeJavaScript('window.open("https://example.com") === null'), true)
  assert.equal(await contents.executeJavaScript('(() => { try { eval("1 + 1"); return false } catch { return true } })()'), true)
  await contents.executeJavaScript('window.location.assign("https://example.com")')
  await new Promise(resolve => setTimeout(resolve, 500))
  assert.equal(contents.getURL(), originalUrl)
  assert.equal(await contents.executeJavaScript('getComputedStyle(document.body).fontFamily.length > 0'), true)
  console.log(JSON.stringify({ event: 'security-smoke', ipc: 'trusted', newWindow: 'denied',
    navigation: 'denied', inlineScript: 'denied', cspStyle: 'loaded' }))
  app.quit()
}

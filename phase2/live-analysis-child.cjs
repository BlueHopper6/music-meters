const { LiveAnalysis } = require('./live-analysis.cjs')
let analyzer, queue = Promise.resolve()
process.parentPort.on('message', ({ data: message }) => {
  if (message.type === 'stop') {
    Promise.resolve(analyzer?.close()).finally(() => process.exit())
    return
  }
  queue = queue.then(async () => {
    if (message.type === 'open') analyzer = new LiveAnalysis(message.input, message.metadata, message.layers, message.frame)
    const frames = await analyzer.pull(message.count || 1)
    process.parentPort.postMessage({ id: message.id, frames })
  }).catch(error => process.parentPort.postMessage({ id: message.id, error: error.message }))
})

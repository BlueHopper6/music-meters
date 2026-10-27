const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { mediaResponse } = require('../playback-video.cjs')
const { analysisLanes } = require('../live-analysis.cjs')

test('preview media serves only its exact capability URL, with bounded byte ranges', async () => {
  const root = path.resolve(__dirname, '../../artifacts/phase2')
  fs.mkdirSync(root, { recursive: true })
  const dir = fs.mkdtempSync(path.join(root, 'playback-media-'))
  const file = path.join(dir, 'synthetic.mp4')
  fs.writeFileSync(file, Buffer.from('0123456789'))
  const media = { path: file, url: 'musicmeters-preview://movie/test.mp4' }
  const request = (url = media.url, headers = {}, method = 'GET') => new Request(url, { headers, method })
  const full = mediaResponse(request(), media)
  assert.equal(full.status, 200); assert.equal(await full.text(), '0123456789')
  const range = mediaResponse(request(media.url, { range: 'bytes=2-4' }), media)
  assert.equal(range.status, 206); assert.equal(range.headers.get('content-range'), 'bytes 2-4/10')
  assert.equal(await range.text(), '234')
  assert.equal(await mediaResponse(request(media.url, { range: 'bytes=-3' }), media).text(), '789')
  assert.equal(mediaResponse(request(media.url, { range: 'bytes=20-' }), media).status, 416)
  assert.equal(mediaResponse(request(media.url, { range: 'bytes=1-2,4-5' }), media).status, 416)
  assert.equal(mediaResponse(request(media.url + '?path=C:/private'), media).status, 404)
  assert.equal(mediaResponse(request('musicmeters-preview://movie/other.mp4'), media).status, 404)
  assert.equal(mediaResponse(request(), null).status, 404)
  assert.equal(mediaResponse(request(media.url, {}, 'POST'), media).status, 405)
  const head = mediaResponse(request(media.url, {}, 'HEAD'), media)
  assert.equal(head.headers.get('content-length'), '10'); assert.equal(await head.text(), '')
  assert.equal(mediaResponse(request(), { ...media, type: 'audio/flac' }).headers.get('content-type'), 'audio/flac')
})

test('independent native configurations use isolated lanes while equivalent layers share one', () => {
  const layers = [
    { id: 'a', type: 'spectrum', visible: true, fftSize: 2048, smoothing: 0.7 },
    { id: 'b', type: 'spectrum', visible: true, fftSize: 2048, smoothing: 0.7 },
    { id: 'c', type: 'spectrum', visible: true, fftSize: 8192, smoothing: 0.7 },
    { id: 'vu', type: 'vu', visible: true },
    { id: 'hidden', type: 'spectrum', visible: false, fftSize: 4096, smoothing: 0.7 },
  ]
  const lanes = analysisLanes({ layers }, 48000)
  assert.equal(lanes.length, 2)
  assert.deepEqual(lanes[0].map(layer => layer.id), ['a', 'b', 'vu'])
  assert.deepEqual(lanes[1].map(layer => layer.id), ['c'])
})

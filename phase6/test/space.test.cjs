const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { assertOutputSpace } = require('../../phase2/space.cjs')

test('preflight rejects an output drive with too little free space', () => {
  const output = path.join(process.cwd(), 'future', 'song.mp4')
  assert.throws(() => assertOutputSpace(output, 120, () => ({ bavail: 10n, bsize: 4096n })),
    /Insufficient disk space/)
})

test('preflight uses the nearest existing parent and accepts sufficient space', () => {
  const output = path.join(process.cwd(), 'future', 'song.mp4')
  let checked
  const result = assertOutputSpace(output, 120, dir => {
    checked = dir
    return { bavail: 1024n * 1024n, bsize: 4096n }
  })
  assert.equal(checked, process.cwd())
  assert.ok(result.availableBytes > result.estimatedBytes)
})

test('source-audio copy reserves the source stream size on the output drive', () => {
  const output = path.join(process.cwd(), 'future', 'song.mkv')
  const volume = () => ({ bavail: 300000n, bsize: 4096n })
  const base = assertOutputSpace(output, 120, volume)
  const copied = assertOutputSpace(output, 120, volume, 240000000n)
  assert.equal(copied.estimatedBytes - base.estimatedBytes, 240000000n)
})

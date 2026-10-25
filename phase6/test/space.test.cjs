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

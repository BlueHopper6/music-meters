const test=require('node:test'),assert=require('node:assert/strict')
const {capture,encoded}=require('../spectrum.cjs')
test('spectrum payload preserves separate raw magnitudes for heat-map fill',()=>{
  const mid=Float32Array.of(-30,-20),side=Float32Array.of(-40,-50),raw=Float32Array.of(-12,-6)
  const native={getMagnitudes:()=>mid,getSideMagnitudes:()=>side,getRawMagnitudes:()=>raw}
  const bytes=capture(native,2),result=encoded(bytes,2)
  assert.equal(bytes.length,24)
  for(const [key,expected] of Object.entries({mid,side,raw}))assert.deepEqual(Buffer.from(result[key],'base64'),Buffer.from(expected.buffer))
  assert.throws(()=>capture({...native,getRawMagnitudes:()=>Float32Array.of(0)},2),/FFT length/)
})

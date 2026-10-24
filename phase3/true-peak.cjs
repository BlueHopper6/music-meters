// Frame-clocked port of the true-peak reconstruction and display ballistics in
// pinned Prism native/src/lufsmeter.cpp. The native analyzer remains the source
// for BS.1770 loudness; cumulative maxima are checked against this port.
const PI = Math.PI
const TAPS = 48
const BETA = 8.6
const MIN_DB = -60

function besselI0(value) {
  const absolute = Math.abs(value)
  if (absolute < 3.75) {
    const squared = (value / 3.75) ** 2
    return 1 + squared * (3.5156229 + squared * (3.0899424 + squared *
      (1.2067492 + squared * (0.2659732 + squared * (0.0360768 + squared * 0.0045813)))))
  }
  const ratio = 3.75 / absolute
  return Math.exp(absolute) / Math.sqrt(absolute) * (0.39894228 + ratio *
    (0.01328592 + ratio * (0.00225319 + ratio * (-0.00157565 + ratio *
    (0.00916281 + ratio * (-0.02057706 + ratio * (0.02635537 + ratio *
    (-0.01647633 + ratio * 0.00392377))))))))
}

function sinc(value) { return Math.abs(value) < 1e-12 ? 1 : Math.sin(PI * value) / (PI * value) }
function db(amplitude) { return amplitude <= 0 ? MIN_DB : Math.max(MIN_DB, 20 * Math.log10(Math.max(amplitude, 1e-10))) }

class TruePeak {
  constructor(sampleRate) {
    this.factor = 1
    while (sampleRate * this.factor < 320000 && this.factor < 64) this.factor *= 2
    this.coefficients = new Float64Array(this.factor * TAPS)
    this.leftHistory = new Float64Array(TAPS * 2)
    this.rightHistory = new Float64Array(TAPS * 2)
    this.position = 0
    this.heldL = MIN_DB
    this.heldR = MIN_DB
    this.maxDb = MIN_DB
    this.holdLUntil = 0
    this.holdRUntil = 0
    this.lastTime = null
    const inverseI0 = 1 / besselI0(BETA)
    const radius = TAPS / 2
    for (let phase = 0; phase < this.factor; phase++) {
      const fraction = phase / this.factor
      let sum = 0
      for (let tap = 0; tap < TAPS; tap++) {
        const distance = tap - radius + fraction
        const normalized = distance / radius
        const window = Math.abs(normalized) <= 1
          ? besselI0(BETA * Math.sqrt(Math.max(0, 1 - normalized * normalized))) * inverseI0 : 0
        const coefficient = sinc(distance) * window
        this.coefficients[phase * TAPS + tap] = coefficient
        sum += coefficient
      }
      if (Math.abs(sum) > 1e-12) {
        for (let tap = 0; tap < TAPS; tap++) this.coefficients[phase * TAPS + tap] /= sum
      }
    }
  }

  process(left, right, nowMs) {
    if (left.length !== right.length) throw new Error('True-peak channels have different lengths')
    if (this.lastTime !== null && nowMs > this.lastTime) {
      const decay = (held, until) => Math.max(MIN_DB, held - Math.max(0, nowMs - Math.max(this.lastTime, until)) / 1000 * 18)
      this.heldL = decay(this.heldL, this.holdLUntil)
      this.heldR = decay(this.heldR, this.holdRUntil)
    }
    this.lastTime = nowMs
    let maxL = 0
    let maxR = 0
    for (let index = 0; index < left.length; index++) {
      const position = this.position
      this.leftHistory[position] = this.leftHistory[position + TAPS] = left[index]
      this.rightHistory[position] = this.rightHistory[position + TAPS] = right[index]
      const newest = position + TAPS
      for (let phase = 0; phase < this.factor; phase++) {
        const offset = phase * TAPS
        let reconstructedL = 0
        let reconstructedR = 0
        for (let tap = 0; tap < TAPS; tap++) {
          const coefficient = this.coefficients[offset + tap]
          reconstructedL += coefficient * this.leftHistory[newest - tap]
          reconstructedR += coefficient * this.rightHistory[newest - tap]
        }
        maxL = Math.max(maxL, Math.abs(reconstructedL))
        maxR = Math.max(maxR, Math.abs(reconstructedR))
      }
      this.position = (position + 1) % TAPS
    }
    const frameL = db(maxL)
    const frameR = db(maxR)
    if (frameL > this.heldL) { this.heldL = frameL; this.holdLUntil = nowMs + 750 }
    if (frameR > this.heldR) { this.heldR = frameR; this.holdRUntil = nowMs + 750 }
    this.maxDb = Math.max(this.maxDb, frameL, frameR)
    return { truePeakLDb: this.heldL, truePeakRDb: this.heldR, maxTruePeakDb: this.maxDb,
      framePeakLDb: frameL, framePeakRDb: frameR }
  }
}

module.exports = { TruePeak }

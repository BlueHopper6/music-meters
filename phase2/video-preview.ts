import { type Project, type AnalysisFrame, decodeAnalysis } from './composition'
import { frameAtTime } from './timecode.cjs'
export type LiveFrame = Parameters<typeof decodeAnalysis>[0] & { frameIndex: number; sampleRate: number }
export type PlaybackStart = { url: string; session: string; frames: LiveFrame[]; superseded?: false } | { superseded: true }
type API = {
  preparePlayback(project: Project, frame: number): Promise<PlaybackStart>
  playbackFrames(session: string, count: number): Promise<LiveFrame[]>
  cancelPlayback(): Promise<void>
}
export function installVideoPreview(api: API, project: () => Project, available: () => boolean,
  position: () => number, setPosition: (seconds: number) => void,
  paint: (data: AnalysisFrame, frame: number, rate: number) => void, resetPainters: () => void, cancelStill: () => void) {
  const audio = document.getElementById('playback-audio') as HTMLAudioElement
  const play = document.getElementById('playback-play') as HTMLButtonElement
  const cancel = document.getElementById('playback-cancel') as HTMLButtonElement
  const status = document.getElementById('playback-status')!
  let generation = 0, starting = false, active = false, key = '', clock = 0, session = ''
  let queue: LiveFrame[] = [], fetching = false, lastFrame = -1, exhausted = false
  let cancelTask: Promise<void> = Promise.resolve()
  let seekTimer: ReturnType<typeof setTimeout> | undefined
  const currentKey = () => JSON.stringify({ ...project(), previewFrame: 0 })
  function controls() {
    play.disabled = !available() || starting
    const playing = active && !audio.paused
    play.classList.toggle('is-playing', playing)
    play.setAttribute('aria-label', playing ? 'Pause preview' : 'Play preview')
    play.title = `${playing ? 'Pause' : 'Play'} preview (Space)`
    play.setAttribute('aria-pressed', String(playing))
    cancel.hidden = !starting
    ;(document.getElementById('refresh-still') as HTMLButtonElement).disabled = starting || playing
  }
  function showFrames() {
    const target = frameAtTime(audio.currentTime)
    while (queue.length && queue[0].frameIndex <= target) {
      const frame = queue.shift()!
      paint(decodeAnalysis(frame), frame.frameIndex, frame.sampleRate)
      lastFrame = frame.frameIndex
    }
    setPosition(audio.currentTime)
  }
  function refill() {
    if (!active || fetching || exhausted || queue.length >= 6) return
    const request = generation
    fetching = true
    void api.playbackFrames(session, 6).then(frames => {
      if (request !== generation) return
      exhausted = frames.length === 0; queue.push(...frames)
      if (audio.paused) showFrames()
    }).catch(error => {
      if (request === generation) reset(`Preview stopped: ${String(error)}`)
    }).finally(() => { if (request === generation) fetching = false })
  }
  function tick() {
    if (!active) return
    showFrames(); refill()
    if (!audio.paused) clock = requestAnimationFrame(tick)
  }
  function pause() {
    const wasPlaying = !audio.paused
    audio.pause(); cancelAnimationFrame(clock)
    // The pause event is asynchronous. Capture the audio clock before callers
    // snapshot the project, without overwriting an already-paused seek target.
    if (active && wasPlaying) showFrames()
    controls()
  }
  function reset(message = 'Play from the current position.') {
    ++generation; starting = false; active = false; key = ''; session = ''
    clearTimeout(seekTimer); fetching = false; queue = []; exhausted = false; lastFrame = -1
    pause(); audio.removeAttribute('src'); audio.load(); status.textContent = message; controls()
    cancelTask = cancelTask.catch(() => {}).then(() => api.cancelPlayback())
    void cancelTask.catch(error => { status.textContent = String(error) })
  }
  async function begin(seconds: number, resume: boolean) {
    const request = ++generation
    cancelStill()
    pause(); active = false; starting = true; fetching = false; exhausted = false; queue = []
    key = currentKey(); controls(); status.textContent = 'Starting preview…'
    document.getElementById('preview-busy')!.hidden = true
    document.getElementById('preview-stale')!.hidden = true
    try {
      await cancelTask
      if (request !== generation) return
      const frame = frameAtTime(seconds)
      const result = await api.preparePlayback(project(), frame)
      if (request !== generation) return
      if (result.superseded) { reset('Preview cancelled.'); return }
      session = result.session; queue = result.frames; lastFrame = frame - 1
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => { clearTimeout(timer); audio.removeEventListener('loadedmetadata', loaded); audio.removeEventListener('error', failed) }
        const loaded = () => { cleanup(); resolve() }
        const failed = () => { cleanup(); reject(new Error(audio.error?.message || 'Cannot play this audio format')) }
        const timer = setTimeout(() => { cleanup(); reject(new Error('Audio load timed out')) }, 10000)
        audio.addEventListener('loadedmetadata', loaded); audio.addEventListener('error', failed)
        audio.src = result.url
      })
      if (request !== generation) return
      resetPainters(); active = true; starting = false
      audio.currentTime = Math.min(frame / 30, Math.max(0, audio.duration - 1 / 30))
      // Paint the selected frame immediately; native audio seeking may complete asynchronously.
      if (queue.length) { const first = queue.shift()!; paint(decodeAnalysis(first), first.frameIndex, first.sampleRate); lastFrame = first.frameIndex }
      status.textContent = 'Live preview · meter history restarts after seeking'
      refill(); controls()
      if (resume) await audio.play()
    } catch (error) {
      if (request === generation && !(error instanceof DOMException && error.name === 'AbortError')) {
        reset(`Cannot start preview: ${String(error)}`)
      }
    } finally { if (request === generation) controls() }
  }
  async function toggle() {
    if (!available() || starting) return
    if (seekTimer !== undefined) {
      clearTimeout(seekTimer); seekTimer = undefined
      await begin(position(), true)
      return
    }
    if (!active) { await begin(position(), true); return }
    if (!audio.paused) pause()
    else if (audio.ended) await begin(0, true)
    else { try { await audio.play() } catch (error) { status.textContent = String(error) } }
    controls()
  }
  play.addEventListener('click', () => { void toggle() })
  cancel.addEventListener('click', () => reset('Preview cancelled.'))
  document.getElementById('playback-muted')!.addEventListener('change', event => { audio.muted = (event.target as HTMLInputElement).checked })
  audio.addEventListener('play', () => { controls(); tick() })
  audio.addEventListener('pause', () => { cancelAnimationFrame(clock); if (active) showFrames(); controls() })
  audio.addEventListener('ended', () => { showFrames(); controls() })
  audio.addEventListener('error', () => { if (active) reset('Audio playback failed. Press Play to retry.') })
  new MutationObserver(() => {
    if (!audio.paused && document.querySelector('.modal-backdrop:not([hidden])')) pause()
  }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['hidden'] })
  document.addEventListener('keydown', event => {
    const target = event.target as HTMLElement
    const onTimeline = target.id === 'time-slider'
    if (event.code !== 'Space' || event.ctrlKey || event.altKey || event.metaKey || event.repeat
      || document.getElementById('editor-screen')!.hidden || document.querySelector('.modal-backdrop:not([hidden])')
      || (!onTimeline && target.closest('input, textarea, select, button, [contenteditable="true"], [role="menu"]'))) return
    event.preventDefault(); void toggle()
  })
  return {
    reset, pause,
    sync() { if (key && key !== currentKey()) reset('Composition changed. Press Play to continue.'); controls() },
    seek(seconds: number) {
      if (!available()) return false
      const resume = !audio.paused
      // A seek can interrupt an unresolved audio.play() promise. Its AbortError
      // belongs to the old position and must not cancel this new seek.
      ++generation; active = false; fetching = false; queue = []
      // Retire the old session before pause events or ticks can repaint its
      // position or refill its queue during the debounced seek.
      pause(); setPosition(seconds)
      clearTimeout(seekTimer)
      seekTimer = setTimeout(() => { seekTimer = undefined; void begin(seconds, resume) }, 70)
      return true
    },
  }
}

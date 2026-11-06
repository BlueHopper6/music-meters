import { userMessage, isQuietCancellation } from './user-message.cjs'

export function installUserFeedback(onError: (message: string) => void) {
  const notice = document.getElementById('error-notice')!
  const title = document.getElementById('error-notice-title')!
  const message = document.getElementById('error-notice-message')!
  const dismiss = document.getElementById('error-notice-dismiss')!
  const loading = document.getElementById('video-loading')!
  const canvas = document.getElementById('stage')!
  let pendingVideoLoads = 0
  function clearError() { notice.hidden = true }
  dismiss.addEventListener('click', clearError)
  notice.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); clearError() }
  })
  function showError(context: string, error: unknown) {
    const text = userMessage(error)
    if (isQuietCancellation(error)) { onError(text); return }
    title.textContent = context
    message.textContent = text
    notice.hidden = false
    onError(`${context}: ${text}`)
  }
  function beginVideoLoading() {
    pendingVideoLoads++
    loading.hidden = false
    canvas.setAttribute('aria-busy', 'true')
    let finished = false
    return () => {
      if (finished) return
      finished = true
      pendingVideoLoads--
      loading.hidden = pendingVideoLoads === 0
      canvas.setAttribute('aria-busy', String(pendingVideoLoads > 0))
    }
  }
  return { clearError, showError, beginVideoLoading }
}

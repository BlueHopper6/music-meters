export function installCommandMenus(): void {
  const triggers = Array.from(document.querySelectorAll<HTMLButtonElement>('.menu-trigger'))
  const popup = (button: HTMLButtonElement) => document.getElementById(button.getAttribute('aria-controls')!)!
  function close(restoreFocus = false) {
    const active = triggers.find(button => button.getAttribute('aria-expanded') === 'true')
    for (const button of triggers) { button.setAttribute('aria-expanded', 'false'); popup(button).hidden = true }
    if (restoreFocus) active?.focus()
  }
  function open(button: HTMLButtonElement, last = false) {
    close()
    button.setAttribute('aria-expanded', 'true'); popup(button).hidden = false
    const items = popup(button).querySelectorAll<HTMLButtonElement>('button:not(:disabled)')
    items[last ? items.length - 1 : 0]?.focus()
  }
  for (const button of triggers) {
    button.addEventListener('click', () => button.getAttribute('aria-expanded') === 'true' ? close(true) : open(button))
    button.addEventListener('keydown', event => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); open(button, event.key === 'ArrowUp') }
    })
    popup(button).addEventListener('click', event => {
      const target = (event.target as HTMLElement).closest<HTMLButtonElement>('button')
      if (!target) return
      close(popup(button).contains(document.activeElement))
      if (target.dataset.command) document.getElementById(target.dataset.command)?.click()
    })
    popup(button).addEventListener('keydown', event => {
      const items = Array.from(popup(button).querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
      const index = items.indexOf(document.activeElement as HTMLButtonElement)
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true) }
      else if (event.key === 'Tab') close(true)
      else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault()
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
        items[next]?.focus()
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault()
        const index = triggers.indexOf(button)
        open(triggers[(index + (event.key === 'ArrowRight' ? 1 : -1) + triggers.length) % triggers.length])
      }
    })
  }
  document.addEventListener('pointerdown', event => { if (!(event.target as HTMLElement).closest('.command-menu')) close() })
  window.addEventListener('blur', () => close())
}

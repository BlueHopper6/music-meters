import { PALETTES } from './meter-style.cjs'

export function installPalettePicker(select: HTMLSelectElement, trigger: HTMLButtonElement, afterChoice: () => void) {
  const menu = document.createElement('div')
  menu.id = 'meter-palette-menu'; menu.className = 'palette-menu'; menu.hidden = true
  menu.setAttribute('role', 'listbox'); menu.setAttribute('aria-label', 'Meter color presets')
  document.body.append(menu)
  const rows: HTMLButtonElement[] = []
  function close(restoreFocus = false) {
    menu.hidden = true; trigger.setAttribute('aria-expanded', 'false')
    if (restoreFocus) trigger.focus({ preventScroll: true })
  }
  function swatches(colors: string[]) {
    const group = document.createElement('span'); group.className = 'palette-swatches'; group.setAttribute('aria-hidden', 'true')
    for (const color of colors) { const dot = document.createElement('i'); dot.style.backgroundColor = color; group.append(dot) }
    return group
  }
  for (const [id, palette] of Object.entries(PALETTES)) {
    const row = document.createElement('button'); row.type = 'button'; row.tabIndex = -1
    row.setAttribute('role', 'option'); row.dataset.palette = id
    row.append(swatches(palette.colors), document.createTextNode(palette.name))
    row.addEventListener('click', () => {
      if (select.disabled) return close()
      select.value = id; close(); select.dispatchEvent(new Event('change', { bubbles: true })); afterChoice()
    })
    rows.push(row); menu.append(row)
  }
  function sync() {
    const palette = Object.hasOwn(PALETTES, select.value) ? PALETTES[select.value as keyof typeof PALETTES] : null
    trigger.replaceChildren(swatches(palette?.colors || ['#71717a']), document.createTextNode(palette?.name || 'Custom style'))
    trigger.disabled = select.disabled
    for (const row of rows) row.setAttribute('aria-selected', String(row.dataset.palette === select.value))
    if (select.disabled) close()
  }
  function open() {
    if (select.disabled) return
    sync()
    const rect = trigger.getBoundingClientRect(), height = Math.min(270, window.innerHeight - 24)
    menu.style.width = `${rect.width}px`; menu.style.maxHeight = `${height}px`
    menu.style.left = `${Math.max(8, Math.min(window.innerWidth - rect.width - 8, rect.left))}px`
    menu.style.top = `${Math.max(8, Math.min(rect.bottom + 5, window.innerHeight - height - 8))}px`
    menu.hidden = false; trigger.setAttribute('aria-expanded', 'true')
    ;(rows.find(row => row.dataset.palette === select.value) || rows[0]).focus({ preventScroll: true })
  }
  trigger.addEventListener('click', () => menu.hidden ? open() : close())
  trigger.addEventListener('keydown', event => {
    if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); open() }
  })
  menu.addEventListener('keydown', event => {
    const index = rows.indexOf(document.activeElement as HTMLButtonElement)
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); rows[index]?.click() }
    else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true) }
    else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); event.stopPropagation()
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length
      rows[next].focus({ preventScroll: true })
    } else if (event.key === 'Tab') close()
  })
  document.addEventListener('pointerdown', event => { if (!menu.contains(event.target as Node) && !trigger.contains(event.target as Node)) close() }, true)
  document.addEventListener('scroll', () => close(), true)
  window.addEventListener('resize', () => close())
  return { sync, close }
}

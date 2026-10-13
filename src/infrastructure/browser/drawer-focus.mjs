// A mobile drawer temporarily owns focus while it covers the main content.
// A trigger resolver also supports a button recreated by the technician shell.
export function manageDrawerFocus(panel, { trigger, onClose, backgroundRoots = [] }) {
  if (!panel) return () => {}
  const previous = new Map(['role', 'aria-modal', 'tabindex'].map(name => [name, panel.getAttribute(name)]))
  const roots = backgroundRoots.filter(Boolean).map(element => ({ element, inert: element.inert }))
  panel.setAttribute('role', 'dialog')
  panel.setAttribute('aria-modal', 'true')
  panel.tabIndex = -1
  roots.forEach(({ element }) => { element.inert = true })
  const controls = () => [...panel.querySelectorAll('button:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])')]
    .filter(element => element.getClientRects().length && !element.closest('[inert]'))
  const focusFirst = () => (controls()[0] || panel).focus({ preventScroll: true })
  const hasTopDialog = () => Boolean(document.querySelector('dialog[open], .modal-layer, .modal-backdrop'))
  const keydown = event => {
    if (hasTopDialog()) return
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onClose()
    } else if (event.key === 'Tab') {
      const items = controls()
      const first = items[0], last = items[items.length - 1]
      if (!first) { event.preventDefault(); panel.focus(); return }
      if (event.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) {
        event.preventDefault(); last.focus()
      } else if (!event.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement))) {
        event.preventDefault(); first.focus()
      }
    }
  }
  const focusin = event => { if (!hasTopDialog() && !panel.contains(event.target)) focusFirst() }
  const frame = requestAnimationFrame(() => { if (panel.isConnected) focusFirst() })
  document.addEventListener('keydown', keydown, true)
  document.addEventListener('focusin', focusin)
  return () => {
    cancelAnimationFrame(frame)
    document.removeEventListener('keydown', keydown, true)
    document.removeEventListener('focusin', focusin)
    roots.forEach(({ element, inert }) => { element.inert = inert })
    previous.forEach((value, name) => value == null ? panel.removeAttribute(name) : panel.setAttribute(name, value))
    requestAnimationFrame(() => {
      const target = typeof trigger === 'function' ? trigger() : trigger
      if (target?.isConnected) target.focus({ preventScroll: true })
    })
  }
}

const controls = 'input, select, textarea'

export function isRequiredControl(control) {
  if (control.disabled || control.type === 'hidden') return false
  if (control.getAttribute('aria-required') === 'false') return false
  return control.required || control.getAttribute('aria-required') === 'true' || Boolean(control.closest('label')?.querySelector('.required-mark'))
}

export function requiredControlMissing(control, scope) {
  if (!isRequiredControl(control)) return false
  if (control.type === 'radio') return ![...scope.querySelectorAll('input[type="radio"]')].some(other => other.name === control.name && other.checked)
  if (control.type === 'checkbox') return !control.checked
  if (control.type === 'file') return !control.files?.length
  return !String(control.value ?? '').trim()
}

// Visual feedback only: existing business validation and messages remain authoritative.
export function installRequiredFeedback(root = document) {
  const attempted = new Set()
  const scopeFor = target => target.closest('form, .modal, [role="dialog"], .task-row, .content')
  const update = (scope, fields = scope.querySelectorAll(controls)) => {
    fields.forEach(control => {
      const missing = requiredControlMissing(control, scope)
      if (missing) {
        control.setAttribute('data-required-missing', 'true')
        control.setAttribute('aria-invalid', 'true')
      } else if (control.hasAttribute('data-required-missing')) {
        control.removeAttribute('data-required-missing')
        control.removeAttribute('aria-invalid')
      }
    })
  }
  const attempt = target => {
    const scope = scopeFor(target)
    if (!scope) return
    attempted.add(scope)
    update(scope)
  }
  const click = event => {
    const button = event.target.closest('button, input[type="submit"]')
    if (!button || button.disabled) return
    const text = (button.textContent || button.value || '').trim()
    if ((button.form && button.type === 'submit') || /^(guardar|confirmar|ingresar|iniciar sesión|vista previa|copiar agenda)\b/i.test(text)) attempt(button)
  }
  const submit = event => attempt(event.target)
  const invalid = event => attempt(event.target)
  const explicit = event => {
    const scope = event.detail?.scope
    if (!scope?.querySelectorAll) return
    attempted.add(scope)
    update(scope)
  }
  const input = event => {
    // Only refresh the attempted form; no application state updates or network calls.
    const scope = scopeFor(event.target)
    if (scope && [...attempted].some(attempt => attempt.contains(event.target)) && event.target.matches(controls)) {
      const fields = event.target.type === 'radio'
        ? [...scope.querySelectorAll('input[type="radio"]')].filter(control => control.name === event.target.name)
        : [event.target]
      update(scope, fields)
    }
  }
  const observer = new MutationObserver(() => {
    for (const scope of attempted) {
      if (!scope.isConnected) attempted.delete(scope)
      else update(scope)
    }
  })
  observer.observe(root.documentElement || root, { childList: true, subtree: true, attributes: true, attributeFilter: ['required', 'aria-required', 'disabled', 'value'] })
  root.addEventListener('click', click, true)
  root.addEventListener('submit', submit, true)
  root.addEventListener('invalid', invalid, true)
  root.addEventListener('pignus:validate-required', explicit)
  root.addEventListener('input', input)
  root.addEventListener('change', input)
  return () => {
    observer.disconnect()
    root.removeEventListener('pignus:validate-required', explicit)
    for (const [name, handler, capture] of [['click', click, true], ['submit', submit, true], ['invalid', invalid, true], ['input', input, false], ['change', input, false]]) root.removeEventListener(name, handler, capture)
    attempted.clear()
  }
}

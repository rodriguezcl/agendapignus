import { useEffect, useRef } from 'react'

const selector = '.modal input, .modal select, .modal textarea'
const valueOf = field => field.type === 'checkbox' || field.type === 'radio' ? field.checked
  : field.multiple ? JSON.stringify([...field.selectedOptions].map(option => option.value)) : field.value

// Focus alone is not an edit. Keep the original value so reverting an input
// also releases the refresh guard; detached/cancelled forms no longer block it.
export function useUnsavedFormFields() {
  const fields = useRef(new Map())
  useEffect(() => {
    const focus = event => {
      const field = event.target
      if (field.matches?.(selector) && !field.readOnly && !fields.current.has(field)) fields.current.set(field, { value: valueOf(field), edited: false })
    }
    const edit = event => {
      const field = event.target
      if (!field.matches?.(selector) || field.readOnly) return
      const before = fields.current.get(field) || { value: field.defaultValue, edited: false }
      fields.current.set(field, { ...before, edited: true })
    }
    document.addEventListener('focusin', focus, true)
    document.addEventListener('input', edit, true)
    document.addEventListener('change', edit, true)
    return () => {
      document.removeEventListener('focusin', focus, true)
      document.removeEventListener('input', edit, true)
      document.removeEventListener('change', edit, true)
      fields.current.clear()
    }
  }, [])
  return () => {
    let dirty = false
    for (const [field, before] of fields.current) {
      if (!field.isConnected) fields.current.delete(field)
      else if (before.edited && valueOf(field) !== before.value) dirty = true
    }
    return dirty
  }
}

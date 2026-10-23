export function submitModalFromEnter(event, dialog) {
  if (event.key !== 'Enter' || event.defaultPrevented || event.isComposing || event.repeat || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || !dialog) return false
  const target = event.target
  if (target?.closest?.('textarea,select,[contenteditable="true"],[role="combobox"],[role="listbox"],input[type="search"]')) return false
  const confirmation = dialog.matches('.confirm-modal,[role="alertdialog"]')
  if (!confirmation && target?.closest?.('button,a,input[type="checkbox"],input[type="radio"],input[type="file"]')) return false
  const selectors = confirmation ? '.confirm-actions .primary,.confirm-actions .danger-button' : 'button[type="submit"],.modal-actions .primary,.modal-footer .primary,.form-actions .primary,.tickets-form-footer .primary,[data-modal-confirm]'
  const actions = [...dialog.querySelectorAll(selectors)].filter(button => button.getClientRects().length && button.closest('[role="dialog"],[role="alertdialog"],.modal') === dialog)
  if (actions.length !== 1) return false
  event.preventDefault()
  event.stopPropagation()
  if (!actions[0].disabled && dialog.getAttribute('aria-busy') !== 'true') actions[0].click()
  return true
}

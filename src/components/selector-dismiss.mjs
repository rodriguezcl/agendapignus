// Clicking a label can focus its enclosing dialog before the browser forwards
// the click to the checkbox. That ancestor focus must not unmount the label.
export function shouldDismissSelector(root, target, eventType) {
  if (!root || !target || root.contains(target)) return false
  if (eventType === 'focusin' && target.contains?.(root)) return false
  return true
}

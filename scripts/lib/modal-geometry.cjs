const assert = require('node:assert/strict')

// Inspect actual rendered dialogs, including their scrollable content. Tables
// may scroll inside their own container; the dialog itself must never overflow.
module.exports = async function inspectModalGeometry(page, label) {
  const dialogs = await page.locator('.modal:visible').evaluateAll(nodes => nodes.map(modal => {
    const visible = element => { const box = element.getBoundingClientRect(); return box.width > 0 && box.height > 0 && getComputedStyle(element).visibility !== 'hidden' }
    const rect = element => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom } }
    return {
      name: modal.className, box: rect(modal), viewport: { width: innerWidth, height: innerHeight },
      clientWidth: modal.clientWidth, scrollWidth: modal.scrollWidth,
      nestedLabels: modal.querySelectorAll('label label, label fieldset').length,
      options: [...modal.querySelectorAll('.service-types-options > label')].filter(visible).map(option => ({ box: rect(option), input: rect(option.querySelector('input')), text: rect(option.querySelector('span')) })),
      footers: [...modal.querySelectorAll('.modal-actions,.history-actions,.confirm-actions,.employee-form-actions,.service-form-actions,.reschedule-footer')].map(footer => [...footer.querySelectorAll(':scope > button')].filter(visible).map(button => ({ ...rect(button), text: button.textContent.trim() }))),
      controls: [...modal.querySelectorAll('input:not([hidden]):not([type="checkbox"]):not([type="radio"]),select,textarea,.service-types-trigger')].filter(visible).map(control => ({ ...rect(control), name: control.getAttribute('aria-label') || control.tagName }))
    }
  }))
  for (const modal of dialogs) {
    const prefix = `${label} / ${modal.name}`
    assert(modal.box.x >= -1 && modal.box.right <= modal.viewport.width + 1, `${prefix}: outside viewport horizontally`)
    assert(modal.box.y >= -1 && modal.box.bottom <= modal.viewport.height + 1, `${prefix}: outside viewport vertically`)
    assert(modal.scrollWidth <= modal.clientWidth + 2, `${prefix}: horizontal content overflow ${modal.scrollWidth}/${modal.clientWidth}`)
    assert.equal(modal.nestedLabels, 0, `${prefix}: nested field labels`)
    for (const option of modal.options) {
      assert(option.input.right <= option.text.x + 1, `${prefix}: checkbox should precede text in the same row`)
      assert(Math.abs((option.input.y + option.input.height / 2) - (option.text.y + option.text.height / 2)) <= 2, `${prefix}: checkbox and text not centered together`)
      assert(option.box.height >= 44, `${prefix}: option touch target is too small`)
    }
    for (const control of modal.controls) {
      assert(control.x >= modal.box.x && control.right <= modal.box.right, `${prefix}: control clipped horizontally (${control.name})`)
      assert(control.height >= 40, `${prefix}: undersized control (${control.name}: ${control.height})`)
    }
    for (const buttons of modal.footers) for (const [index, button] of buttons.entries()) {
      assert(button.height >= 44, `${prefix}: undersized action ${button.text}`)
      for (const other of buttons.slice(index + 1)) {
        assert(button.right <= other.x + 1 || other.right <= button.x + 1 || button.bottom <= other.y + 1 || other.bottom <= button.y + 1, `${prefix}: overlapping actions`)
        if (Math.abs(button.y - other.y) < 2) assert(Math.abs(button.height - other.height) <= 2, `${prefix}: uneven action heights`)
      }
    }
  }
  return dialogs.map(({ name, box, controls, options }) => ({ name, box, controls: controls.length, options: options.length }))
}

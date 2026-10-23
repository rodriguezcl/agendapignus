import DOMPurify from 'dompurify'

const tags = ['p', 'br', 'div', 'span', 'strong', 'b', 'em', 'i', 'u', 's', 'a', 'img', 'table', 'tbody', 'thead', 'tfoot', 'tr', 'td', 'th', 'hr', 'ul', 'ol', 'li', 'font']
const attributes = ['href', 'src', 'alt', 'title', 'style', 'width', 'height', 'colspan', 'rowspan', 'color', 'face', 'size']
const styles = new Set(['color', 'background-color', 'font-family', 'font-size', 'font-weight', 'font-style', 'text-decoration', 'text-align', 'vertical-align', 'line-height', 'width', 'max-width', 'height', 'border', 'border-top', 'border-bottom', 'border-left', 'border-right', 'border-collapse', 'padding', 'padding-top', 'padding-bottom', 'padding-left', 'padding-right', 'margin', 'margin-top', 'margin-bottom', 'margin-left', 'margin-right'])

export function cleanSignatureHtml(value) {
  const fragment = DOMPurify.sanitize(String(value || ''), { ALLOWED_TAGS: tags, ALLOWED_ATTR: attributes, ALLOW_DATA_ATTR: false, ALLOW_ARIA_ATTR: false, RETURN_DOM_FRAGMENT: true })
  for (const element of fragment.querySelectorAll('*')) {
    if (element.hasAttribute('style')) {
      for (const property of [...element.style]) {
        const content = element.style.getPropertyValue(property)
        if (!styles.has(property) || /url\s*\(|expression|@|\\|var\s*\(|[<>]/i.test(content)) element.style.removeProperty(property)
        else element.style.setProperty(property, content, '')
      }
    }
    if (element.tagName === 'IMG') {
      try { const url = new URL(element.getAttribute('src')); if (url.protocol !== 'https:' || url.username || url.password) element.remove() }
      catch { element.remove() }
    }
    if (element.tagName === 'A') {
      try { const url = new URL(element.getAttribute('href')); if (!['https:', 'http:', 'mailto:', 'tel:'].includes(url.protocol) || url.username || url.password) element.removeAttribute('href') }
      catch { element.removeAttribute('href') }
    }
  }
  const container = document.createElement('div')
  container.append(fragment)
  return container.innerHTML
}

export function signatureTextHtml(text) {
  const element = document.createElement('div')
  element.textContent = String(text || '')
  return element.innerHTML.replace(/\r?\n/g, '<br>')
}

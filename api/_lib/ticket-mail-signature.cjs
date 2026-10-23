const sanitizeHtml = require('./mail-sanitizer-runtime.cjs')
const { convert } = require('html-to-text')
const { isIP } = require('node:net')
const { isPublicMailAddress } = require('./ticket-mail-network.cjs')

const MAX_SIGNATURE_HTML = 50000
const MAX_SIGNATURE_TEXT = 8000
const failure = message => Object.assign(new Error(message), { code: 'MAIL_SIGNATURE_INVALID', statusCode: 400 })
const emptySignature = () => ({ enabled: false, html: '', text: '' })
const color = /^(?:#[a-f\d]{3,8}|[a-z]{1,24}|rgba?\([\d\s.,%]+\))$/i
const dimension = /^(?:0|\d{1,4}(?:\.\d{1,2})?(?:px|pt|em|rem|%))$/i
const spacing = /^(?:0|\d{1,3}(?:\.\d{1,2})?(?:px|pt|em|rem))(?:\s+(?:0|\d{1,3}(?:\.\d{1,2})?(?:px|pt|em|rem))){0,3}$/i

function safeUrl(value, image = false) {
  if (typeof value !== 'string' || !value || value.length > 2048 || /[\x00-\x20\x7f]/.test(value)) return ''
  try {
    const url = new URL(value)
    if (!image && url.protocol === 'mailto:') return /^mailto:[^<>\s]+$/i.test(value) ? value : ''
    if (!image && url.protocol === 'tel:') return /^tel:[+\d().-]+$/i.test(value) ? value : ''
    if (!(image ? ['https:'] : ['https:', 'http:']).includes(url.protocol) || url.username || url.password) return ''
    const hostname = url.hostname.replace(/^\[|\]$/g, '')
    if (isIP(hostname)) { if (!isPublicMailAddress(hostname)) return '' }
    else if (!hostname.includes('.') || /(?:^|\.)(?:localhost|local|internal|home|lan|invalid|test)$/i.test(hostname)) return ''
    return url.href
  } catch { return '' }
}

function sanitizeSignatureHtml(value) {
  return sanitizeHtml(value, {
    allowedTags: ['p', 'div', 'span', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'a', 'img', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'hr', 'ul', 'ol', 'li', 'font'],
    nonTextTags: ['script', 'style', 'textarea', 'option', 'noscript', 'svg', 'math', 'iframe', 'object', 'embed', 'template', 'form'],
    allowedAttributes: {
      '*': ['style'], a: ['href', 'title', 'rel', 'target'], img: ['src', 'alt', 'title', 'width', 'height'],
      table: ['cellpadding', 'cellspacing', 'border', 'width', 'align'], td: ['colspan', 'rowspan', 'width', 'align', 'valign'], th: ['colspan', 'rowspan', 'width', 'align', 'valign'],
      font: ['color', 'face', 'size']
    },
    allowedSchemes: ['https', 'http', 'mailto', 'tel'], allowedSchemesByTag: { img: ['https'] }, allowProtocolRelative: false,
    allowedStyles: { '*': {
      color: [color], 'background-color': [color], 'font-family': [/^[a-z\d\s,'"-]{1,160}$/i],
      'font-size': [dimension], 'font-weight': [/^(?:normal|bold|[1-9]00)$/], 'font-style': [/^(?:normal|italic)$/],
      'text-decoration': [/^(?:none|underline|line-through)$/], 'text-align': [/^(?:left|center|right|justify)$/],
      'vertical-align': [/^(?:top|middle|bottom|baseline)$/], 'line-height': [/^(?:normal|\d{1,3}(?:\.\d{1,2})?(?:px|pt|em|rem|%)?)$/],
      width: [dimension], height: [dimension], 'max-width': [dimension],
      padding: [spacing], 'padding-left': [dimension], 'padding-right': [dimension], 'padding-top': [dimension], 'padding-bottom': [dimension],
      margin: [spacing], 'margin-left': [dimension], 'margin-right': [dimension], 'margin-top': [dimension], 'margin-bottom': [dimension],
      'border-collapse': [/^(?:collapse|separate)$/], 'border-spacing': [spacing],
      border: [/^(?:0|\d{1,2}px\s+(?:solid|dashed|dotted)\s+(?:#[a-f\d]{3,8}|[a-z]{1,24}))$/i],
      'border-color': [color], 'border-width': [spacing], 'border-style': [/^(?:none|solid|dashed|dotted)$/]
    } },
    transformTags: { '*': (tagName, attributes) => {
      const attribs = { ...attributes }
      if (tagName === 'a') {
        const href = safeUrl(attribs.href)
        if (href) { attribs.href = href; attribs.rel = 'noopener noreferrer'; attribs.target = '_blank' }
        else { delete attribs.href; delete attribs.target; delete attribs.rel }
      }
      if (tagName === 'img') { const src = safeUrl(attribs.src, true); if (src) attribs.src = src; else delete attribs.src }
      for (const key of ['width', 'height', 'colspan', 'rowspan', 'cellpadding', 'cellspacing', 'border']) if (attribs[key] && !/^\d{1,4}%?$/.test(attribs[key])) delete attribs[key]
      if (attribs.align && !/^(left|center|right)$/i.test(attribs.align)) delete attribs.align
      if (attribs.valign && !/^(top|middle|bottom|baseline)$/i.test(attribs.valign)) delete attribs.valign
      if (tagName === 'font') {
        if (attribs.color && !color.test(attribs.color)) delete attribs.color
        if (attribs.face && !/^[a-z\d\s,'"-]{1,160}$/i.test(attribs.face)) delete attribs.face
        if (attribs.size && !/^[1-7]$/.test(attribs.size)) delete attribs.size
      }
      return { tagName, attribs }
    } },
    exclusiveFilter: frame => frame.tag === 'img' && !frame.attribs.src
  }).trim()
}

function normalizeSignature(input) {
  if (input === undefined || input === null) return emptySignature()
  if (!input || typeof input !== 'object' || Array.isArray(input) || typeof input.enabled !== 'boolean' || typeof input.html !== 'string') throw failure('La firma debe incluir un contenido válido y su estado de activación.')
  if (input.html.length > MAX_SIGNATURE_HTML) throw failure('La firma supera los 50000 caracteres de formato admitidos.')
  let html, text
  try {
    html = sanitizeSignatureHtml(input.html)
    text = convert(html, {
      wordwrap: false,
      formatters: { signatureImage: (element, _walk, builder) => builder.addInline(element.attribs?.alt || '', { noWordTransform: true }) },
      selectors: [{ selector: 'a', options: { hideLinkHrefIfSameAsText: true } }, { selector: 'img', format: 'signatureImage' }]
    }).trim()
  } catch { throw failure('No se pudo interpretar el formato de la firma.') }
  if (html.length > MAX_SIGNATURE_HTML || text.length > MAX_SIGNATURE_TEXT) throw failure('La firma supera el tamaño admitido: 50000 caracteres de formato y 8000 de texto.')
  if (input.enabled && !text && !/<img\s[^>]*src=/i.test(html)) throw failure('Ingresá el contenido de la firma antes de activarla.')
  return { enabled: input.enabled, html, text }
}

function appendSignature(replyText, input) {
  const signature = normalizeSignature(input)
  if (!signature.enabled) return { text: replyText }
  const escaped = String(replyText).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/\r\n?|\n/g, '<br>')
  return { text: [replyText, signature.text].filter(Boolean).join('\n\n'), html: `<div>${escaped}</div><br><div>${signature.html}</div>` }
}

module.exports = { MAX_SIGNATURE_HTML, MAX_SIGNATURE_TEXT, emptySignature, normalizeSignature, sanitizeSignatureHtml, appendSignature }

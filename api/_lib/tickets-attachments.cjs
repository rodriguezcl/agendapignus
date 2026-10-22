const { randomUUID } = require('node:crypto')

// El total cabe en la solicitud JSON de Vercel incluso después de codificar base64.
const MAX_FILE_BYTES = 2 * 1024 * 1024
const MAX_TOTAL_BYTES = Math.floor(2.5 * 1024 * 1024)
const MAX_FILES = 5
const fail = message => { throw Object.assign(new Error(message), { statusCode: 400 }) }
function detectedMime(bytes) {
  if (bytes.subarray(0, 5).toString() === '%PDF-') return 'application/pdf'
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png'
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg'
  if (bytes.length >= 12 && bytes.subarray(0,4).toString() === 'RIFF' && bytes.subarray(8,12).toString() === 'WEBP') return 'image/webp'
  return ''
}
function validateAttachments(files = []) {
  if (!Array.isArray(files) || files.length > MAX_FILES) fail('Podés adjuntar hasta 5 archivos por aporte.')
  let total = 0
  return files.map(file => {
    if (!file || typeof file.data !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(file.data) || file.data.length > Math.ceil(MAX_FILE_BYTES / 3) * 4) fail('El adjunto no es válido o supera 2 MB.')
    const bytes = Buffer.from(file.data, 'base64')
    if (!bytes.length || bytes.length > MAX_FILE_BYTES || bytes.toString('base64') !== file.data) fail('El adjunto está vacío o su codificación no es válida.')
    total += bytes.length
    if (total > MAX_TOTAL_BYTES) fail('Los adjuntos de un aporte no pueden superar 2,5 MB en total.')
    const mimeType = detectedMime(bytes)
    if (!mimeType || mimeType !== (file.mimeType || file.mime)) fail('Adjuntá PDF, JPG, PNG o WEBP cuyo contenido coincida con el formato indicado.')
    const fileName = String(file.fileName || file.name || 'Adjunto').replace(/[\\/\x00-\x1f\x7f]/g, '_').slice(0, 180)
    return { id: randomUUID(), fileName, mimeType, byteSize: bytes.length, data: bytes.toString('base64') }
  })
}
function sanitizeAttachment({ id, fileName, mimeType, byteSize }) { return { id, fileName, mimeType, byteSize } }
module.exports = { validateAttachments, sanitizeAttachment, detectedMime, MAX_FILE_BYTES, MAX_TOTAL_BYTES, MAX_FILES }

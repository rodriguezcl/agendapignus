const { randomUUID, createHash } = require('node:crypto')
const { detectedMime } = require('./tickets-attachments.cjs')

const MAX_FILE_BYTES = 3 * 1024 * 1024
const fail = message => { throw Object.assign(new Error(message), { statusCode: 400, code: 'CCTV_ATTACHMENT_INVALID' }) }

function validateCctvAttachment(file, action) {
  if (file == null) return null
  if (!file || typeof file !== 'object' || Array.isArray(file)) fail('Seleccioná un único archivo válido.')
  if (typeof file.data !== 'string' || file.data.length > Math.ceil(MAX_FILE_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(file.data)) fail('El archivo debe pesar como máximo 3 MB.')
  const data = Buffer.from(file.data, 'base64')
  if (!data.length || data.length > MAX_FILE_BYTES || data.toString('base64') !== file.data) fail('El archivo está vacío o su codificación no es válida.')
  const mimeType = detectedMime(data)
  const allowed = action === 'addNews' ? ['application/pdf'] : action === 'addPlan' ? ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] : []
  if (!allowed.includes(mimeType) || mimeType !== (file.mimeType || file.mime)) fail(action === 'addNews' ? 'En Novedades sólo se admiten archivos PDF.' : 'El contenido debe coincidir con un archivo PDF, JPG, PNG o WEBP.')
  const fileName = String(file.fileName || file.name || 'Adjunto').replace(/[\\/\x00-\x1f\x7f]/g, '_').trim().slice(0, 180) || 'Adjunto'
  return { id: randomUUID(), fileName, mimeType, byteSize: data.length, digest: createHash('sha256').update(data).digest('hex'), data }
}

const attachmentMetadata = file => file ? { id: file.id, fileName: file.fileName, mimeType: file.mimeType, byteSize: file.byteSize } : null

module.exports = { validateCctvAttachment, attachmentMetadata, MAX_FILE_BYTES }

const crypto = require('node:crypto')
const MAX_FILES = 20
const MAX_BYTES = 3_000_000
const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode })

function decodeAttachment(body) {
  if (!/^[a-zA-Z0-9-]{16,80}$/.test(body?.id || '')) throw fail('El identificador del adjunto no es válido.')
  const match = /^data:(image\/(?:jpeg|png|webp)|application\/pdf);base64,([a-zA-Z0-9+/]+={0,2})$/.exec(body.data || '')
  if (!match || match[2].length > Math.ceil(MAX_BYTES / 3) * 4) throw fail('Seleccioná una imagen o PDF de hasta 3 MB.')
  const data = Buffer.from(match[2], 'base64'), mime = match[1]
  const valid = mime === 'application/pdf' ? data.subarray(0, 5).toString() === '%PDF-'
    : mime === 'image/jpeg' ? data[0] === 255 && data[1] === 216 && data[2] === 255
      : mime === 'image/png' ? data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
        : data.subarray(0, 4).toString() === 'RIFF' && data.subarray(8, 12).toString() === 'WEBP'
  if (!valid || !data.length || data.length > MAX_BYTES) throw fail('El archivo no es una imagen o PDF válido de hasta 3 MB.')
  const extension = { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }[mime]
  const base = String(body.name || 'Adjunto').replace(/[\x00-\x1f\x7f/\\]/g, '_').replace(/\.[^.]*$/, '').trim().slice(0, 140) || 'Adjunto'
  return { id: body.id, name: base + extension, mime, bytes: data.length, data, digest: crypto.createHash('sha256').update(data).digest('hex'), createdAt: new Date().toISOString() }
}

function attachmentAccess(user, scope, entity) {
  if (!entity) return { read: false, write: false }
  if (user.roleCode === 'administrator') return { read: true, write: true }
  if (scope === 'vehicle') return { read: user.roleCode !== 'operator' && (user.roleCode === 'technician' || user.technicalEnabled || Boolean(user.permissions?.vehicles)), write: false }
  if (user.roleCode === 'operator') return { read: true, write: false }
  const assigned = entity.technicianIds?.some(id => String(id) === String(user.id))
  if (user.roleCode === 'technician') return { read: Boolean(assigned), write: Boolean(assigned && entity.vehicleControl) }
  if (user.roleCode === 'supervisor') return { read: Boolean(entity.supervisorVisible), write: false }
  const manage = ['weekly', 'agenda', 'history'].some(key => user.permissions?.[key])
  return { read: manage || Boolean(assigned), write: manage || Boolean(assigned && user.technicalEnabled) }
}

async function handleAttachments({ req, res, body, user, scope, entityId, attachmentId, entity, store }) {
  if (!['service', 'vehicle'].includes(scope) || !entityId || entityId.length > 200) throw fail('Destino de adjuntos inválido.')
  const access = attachmentAccess(user, scope, entity)
  if (!access.read || (req.method !== 'GET' && !access.write)) throw fail('No tenés permiso para acceder a estos adjuntos.', 403)
  const json = value => { res.statusCode = 200; res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(value)) }
  await store.ensure()
  const canDelete = file => access.write && (user.roleCode === 'administrator' || (user.roleCode !== 'technician' && ['weekly', 'agenda', 'history'].some(key => user.permissions?.[key])) || String(file.uploadedBy) === String(user.id))
  if (req.method === 'GET' && !attachmentId) return json({ attachments: (await store.list(scope, entityId)).map(file => ({ ...file, canDelete: canDelete(file) })), canWrite: access.write, cameraOnly: user.roleCode === 'technician', limit: MAX_FILES })
  if (req.method === 'POST' && !attachmentId) {
    const file = decodeAttachment(body)
    if (user.roleCode === 'technician' && (!file.mime.startsWith('image/') || body.source !== 'camera')) throw fail('Los técnicos solo pueden cargar fotos desde la cámara en controles vehiculares.', 403)
    await store.add(scope, entityId, { ...file, uploadedBy: String(user.id) })
    return json({ ok: true, id: file.id })
  }
  if (!attachmentId || !['GET', 'DELETE'].includes(req.method)) throw fail('Operación de adjuntos inválida.')
  const metadata = (await store.list(scope, entityId)).find(file => file.id === attachmentId)
  if (!metadata) throw fail('El adjunto ya no existe.', 404)
  if (req.method === 'DELETE') { if (!canDelete(metadata)) throw fail('Solo podés quitar tus propios adjuntos.', 403); await store.remove(scope, entityId, attachmentId); return json({ ok: true }) }
  res.setHeader('Cache-Control', 'private, no-cache')
  const etag = `"${metadata.digest}"`
  res.setHeader('ETag', etag)
  res.setHeader('X-Content-Type-Options', 'nosniff')
  if (req.headers['if-none-match'] === etag) { res.statusCode = 304; return res.end() }
  const data = await store.content(scope, entityId, attachmentId)
  if (!data) throw fail('El adjunto ya no existe.', 404)
  res.setHeader('Content-Type', metadata.mime)
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(metadata.name)}`)
  res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'")
  res.statusCode = 200
  res.end(data)
}
module.exports = { decodeAttachment, attachmentAccess, handleAttachments, MAX_FILES, MAX_BYTES, fail }

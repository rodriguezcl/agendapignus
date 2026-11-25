import { requestJson } from '../http/json-request.mjs'

export const CCTV_FILE_LIMIT = 3 * 1024 * 1024
const imageTypes = ['image/jpeg', 'image/png', 'image/webp']
const fileTypes = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }

export async function encodeCctvFile(file, { allowImages = false } = {}) {
  if (!file) return null
  if (!file.size || file.size > CCTV_FILE_LIMIT) throw new Error('El archivo debe tener contenido y pesar hasta 3 MB.')
  const mimeType = file.type || fileTypes[String(file.name || '').split('.').at(-1).toLowerCase()]
  if (mimeType !== 'application/pdf' && !(allowImages && imageTypes.includes(mimeType))) {
    throw new Error(allowImages ? 'Elegí un archivo PDF, JPG, PNG o WEBP.' : 'Elegí un archivo PDF.')
  }
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (bytes.length > CCTV_FILE_LIMIT) throw new Error('El archivo supera los 3 MB.')
  let binary = ''
  for (let index = 0; index < bytes.length; index += 8192) binary += String.fromCharCode(...bytes.subarray(index, index + 8192))
  return { fileName: file.name, mimeType, data: btoa(binary) }
}

// Keep the same identifier after an uncertain network response. A changed
// draft or an explicitly refreshed version is a new, reviewable command.
export function createCctvCommandSession(createId = () => globalThis.crypto.randomUUID()) {
  const attempts = new Map()
  return {
    prepare(input) {
      const key = JSON.stringify(input)
      if (!attempts.has(key)) attempts.set(key, { ...structuredClone(input), commandId: createId() })
      return attempts.get(key)
    },
    accepted(command) {
      for (const [key, value] of attempts) if (value.commandId === command.commandId) attempts.delete(key)
    }
  }
}

export const cctvAttachmentUrl = (customerId, attachmentId) => '/api/cctv/attachments?' + new URLSearchParams({ customerId, attachmentId })

export const cctvRepository = {
  list: () => requestJson('/api/cctv', {}, 'No se pudieron cargar las cuentas de CCTV.'),
  detail: customerId => requestJson('/api/cctv?' + new URLSearchParams({ customerId }), {}, 'No se pudo cargar la ficha de CCTV.'),
  save: command => {
    const body = JSON.stringify(command)
    if (new TextEncoder().encode(body).byteLength > 4_300_000) throw new Error('El archivo y el contenido juntos son demasiado grandes. Usá un archivo más liviano o simplificá el esquema.')
    return requestJson('/api/cctv', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }, 'No se pudo guardar la información de CCTV.')
  }
}

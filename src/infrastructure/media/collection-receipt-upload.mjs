export const COLLECTION_RECEIPT_MAX_BYTES = 3_000_000
const imageTypes = ['image/jpeg', 'image/png', 'image/webp']
const extensions = { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }
const readData = blob => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(String(reader.result || ''))
  reader.onerror = () => reject(new Error('No se pudo leer el comprobante. Volvé a seleccionar el archivo.'))
  reader.readAsDataURL(blob)
})
const fileName = (name, mime) => (String(name || 'Comprobante').replace(/[\x00-\x1f\x7f/\\]/g, '_').replace(/\.[^.]*$/, '').trim().slice(0, 140) || 'Comprobante') + extensions[mime]
const sniffType = bytes => {
  if ([37, 80, 68, 70, 45].every((value, index) => bytes[index] === value)) return 'application/pdf'
  if ([255, 216, 255].every((value, index) => bytes[index] === value)) return 'image/jpeg'
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) return 'image/png'
  if ([82, 73, 70, 70].every((value, index) => bytes[index] === value) && [87, 69, 66, 80].every((value, index) => bytes[index + 8] === value)) return 'image/webp'
  return null
}

// Preserve small originals. Only oversized photos are recompressed, at a size
// suitable for reading a receipt; reject them rather than shrinking indefinitely.
export async function prepareCollectionReceipt(file) {
  if (!file?.size) throw new Error('Seleccioná una imagen o un PDF que no esté vacío.')
  if (file.size > 20_000_000) throw new Error('El archivo original supera los 20 MB. Seleccioná una foto de menor tamaño o un PDF de hasta 3 MB.')
  const mime = sniffType(new Uint8Array(await file.slice(0, 12).arrayBuffer()))
  if (!mime) throw new Error('El comprobante debe ser un PDF o una imagen JPEG, PNG o WebP válida.')
  if (mime === 'application/pdf' && file.size > COLLECTION_RECEIPT_MAX_BYTES) throw new Error('El PDF supera los 3 MB. Seleccioná una versión de menor tamaño.')
  let prepared = new Blob([file], { type: mime })
  let outputMime = mime
  if (imageTypes.includes(mime)) {
    const url = URL.createObjectURL(prepared)
    try {
      const image = await new Promise((resolve, reject) => {
        const candidate = new Image()
        candidate.onload = () => resolve(candidate)
        candidate.onerror = () => reject(new Error('No se pudo abrir la imagen. Seleccioná otra foto o un PDF legible.'))
        candidate.src = url
      })
      if (!image.naturalWidth || !image.naturalHeight) throw new Error('La imagen no tiene un tamaño válido.')
      if (prepared.size > COLLECTION_RECEIPT_MAX_BYTES) {
        const canvas = document.createElement('canvas')
        const context = canvas.getContext('2d')
        if (!context) throw new Error('Este navegador no pudo preparar la foto. Seleccioná un archivo de hasta 3 MB.')
        let compact = null
        for (const [dimension, quality] of [[4096, .9], [4096, .82], [3200, .84], [2560, .82]]) {
          const scale = Math.min(1, dimension / Math.max(image.naturalWidth, image.naturalHeight))
          canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
          canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
          context.fillStyle = '#fff'
          context.fillRect(0, 0, canvas.width, canvas.height)
          context.drawImage(image, 0, 0, canvas.width, canvas.height)
          compact = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality))
          if (compact?.size <= COLLECTION_RECEIPT_MAX_BYTES) break
        }
        canvas.width = 0
        canvas.height = 0
        if (!compact || compact.size > COLLECTION_RECEIPT_MAX_BYTES) throw new Error('La foto sigue superando los 3 MB. Recortá el comprobante o elegí una imagen de menor tamaño.')
        prepared = compact
        outputMime = 'image/jpeg'
      }
    } finally { URL.revokeObjectURL(url) }
  }
  return {
    id: crypto.randomUUID(),
    name: fileName(file.name, outputMime),
    data: await readData(prepared),
    mime: outputMime,
    bytes: prepared.size,
    compressed: file.size > COLLECTION_RECEIPT_MAX_BYTES,
  }
}

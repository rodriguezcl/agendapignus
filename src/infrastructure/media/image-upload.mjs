export async function compactVehiclePhoto(file, { maximumDimension = 1280, quality = 0.78 } = {}) {
  if (!file || !String(file.type || '').startsWith('image/')) throw new Error('Seleccioná una imagen válida.')
  const source = await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(new Error('No se pudo leer la imagen.'))
    reader.readAsDataURL(file)
  })
  const image = await new Promise((resolve, reject) => {
    const element = new Image()
    element.onload = () => resolve(element)
    element.onerror = () => reject(new Error('No se pudo procesar esta imagen. Probá tomar una foto nueva con la cámara.'))
    element.src = source
  })
  const scale = Math.min(1, maximumDimension / Math.max(image.naturalWidth, image.naturalHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height)
  const compact = canvas.toDataURL('image/jpeg', quality)
  if (compact.length > 1_300_000) throw new Error('La foto es demasiado pesada. Probá con una imagen de menor resolución.')
  return compact
}

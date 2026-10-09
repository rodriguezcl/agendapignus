// Use a live camera stream, never a file picker (capture attributes can still
// offer the gallery on some browsers).
export async function captureCameraPhoto() {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('La cámara no está disponible en este navegador. Usá un navegador con acceso a cámara.')
  let stream
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
  } catch (error) {
    if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
      throw new Error('No se pudo acceder a la cámara. Permití el acceso a la cámara en los permisos de este sitio y del navegador en tu teléfono, y volvé a intentar.')
    }
    if (error.name === 'NotFoundError') throw new Error('No se encontró una cámara disponible en este dispositivo.')
    if (error.name === 'NotReadableError') throw new Error('No se pudo abrir la cámara. Cerrá otras aplicaciones que la estén usando y volvé a intentar.')
    throw new Error('No se pudo iniciar la cámara. Volvé a intentar desde el navegador de tu teléfono.')
  }
  const dialog = document.createElement('dialog')
  const video = document.createElement('video')
  video.autoplay = true; video.muted = true; video.playsInline = true; video.srcObject = stream
  video.style.cssText = 'width:100%;max-height:65vh;object-fit:contain'
  dialog.style.cssText = 'width:min(94vw,640px);border-radius:12px;padding:16px'
  dialog.setAttribute('aria-label', 'Tomar foto del control vehicular')
  const take = document.createElement('button'), cancel = document.createElement('button')
  take.type = cancel.type = 'button'
  take.textContent = 'Tomar foto'; take.title = 'Capturá una foto con la cámara en vivo.'; take.disabled = true
  cancel.textContent = 'Cancelar'; cancel.title = 'Cerrá la cámara sin agregar ninguna foto.'
  dialog.append(video, take, cancel); document.body.append(dialog)
  try {
    return await new Promise((resolve, reject) => {
      const stop = () => resolve(null)
      cancel.onclick = stop
      dialog.oncancel = event => { event.preventDefault(); stop() }
      video.onloadedmetadata = () => { take.disabled = false }
      video.onerror = () => reject(new Error('No se pudo iniciar la cámara.'))
      take.onclick = () => {
        const canvas = document.createElement('canvas')
        const scale = Math.min(1, 1280 / Math.max(video.videoWidth, video.videoHeight))
        canvas.width = Math.max(1, Math.round(video.videoWidth * scale)); canvas.height = Math.max(1, Math.round(video.videoHeight * scale))
        canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height)
        canvas.toBlob(blob => blob ? resolve(new File([blob], `control-${Date.now()}.jpg`, { type: 'image/jpeg' })) : reject(new Error('No se pudo capturar la foto.')), 'image/jpeg', .78)
      }
      dialog.showModal()
      video.play().catch(() => reject(new Error('No se pudo iniciar la cámara.')))
    })
  } finally { stream.getTracks().forEach(track => track.stop()); video.srcObject = null; dialog.remove() }
}

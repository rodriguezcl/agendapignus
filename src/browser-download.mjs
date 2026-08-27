export function reportDownloadName(month, category, format = 'excel') {
  const extension = format === 'pdf' ? 'pdf' : 'xls'
  return category === 'retirements'
    ? `bajas-servicio-${month}.${extension}`
    : `instalaciones-alarma-${category}-${month}.${extension}`
}

export function triggerBrowserDownload(href, fileName, documentRef = globalThis.document) {
  if (!documentRef?.body) {
    globalThis.location?.assign?.(href)
    return
  }
  const link = documentRef.createElement('a')
  link.href = href
  link.download = fileName
  // Si el navegador móvil no implementa download, abre el archivo para que el
  // usuario pueda guardarlo desde el visor nativo sin abandonar AgendaPignus.
  link.target = '_blank'
  link.rel = 'noopener'
  link.style.display = 'none'
  documentRef.body.append(link)
  link.click()
  link.remove()
}

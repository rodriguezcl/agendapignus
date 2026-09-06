const serviceNameCollator = new Intl.Collator('es-AR', {
  sensitivity: 'base',
  numeric: true
})

export function sortServicesAlphabetically(services = []) {
  return [...services].sort((first, second) => serviceNameCollator.compare(
    String(first?.name || ''),
    String(second?.name || '')
  ))
}

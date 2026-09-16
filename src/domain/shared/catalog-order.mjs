const collator = new Intl.Collator('es-AR', { sensitivity: 'base', numeric: true })

export const sortEmployeesAlphabetically = (employees = []) => [...employees].sort((a, b) =>
  collator.compare(String(a.name || '').trim(), String(b.name || '').trim()))

export const sortVehiclesAlphabetically = (vehicles = []) => [...vehicles].sort((a, b) =>
  collator.compare(`${a.brand || ''} ${a.model || ''}`.trim(), `${b.brand || ''} ${b.model || ''}`.trim()) ||
  collator.compare(String(a.plate || ''), String(b.plate || '')))

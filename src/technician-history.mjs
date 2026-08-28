const normalize = value => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLocaleLowerCase('es-AR')

const searchableDate = value => {
  if (!value) return ''
  const parsed = new Date(`${value}T12:00:00`)
  return Number.isNaN(parsed.getTime())
    ? value
    : `${value} ${parsed.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`
}

export function technicianHistorySearchText(record) {
  return normalize([
    record.client,
    record.clientAccount,
    record.clientNameAtService,
    record.service,
    record.detail,
    record.address,
    record.phone,
    record.technicalStatus,
    record.status,
    searchableDate(record.date),
    record.time,
    record.team,
    ...(record.technicians || [])
  ].join(' '))
}

export function filterTechnicianHistory(records, query) {
  const terms = normalize(query).trim().split(/\s+/).filter(Boolean)
  if (!terms.length) return records
  return records.filter(record => {
    const searchable = technicianHistorySearchText(record)
    return terms.every(term => searchable.includes(term))
  })
}

export function technicianTeamLabel(record) {
  const technicians = [...new Set((record?.technicians || []).map(name => String(name).trim()).filter(Boolean))]
  const team = String(record?.team || '').trim()
  if (!technicians.length) return team || 'Sin técnicos asignados'
  return [team, technicians.join(' / ')].filter(Boolean).join(' · ')
}

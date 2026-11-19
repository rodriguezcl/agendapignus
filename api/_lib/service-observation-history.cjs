function serviceObservations(record = {}) {
  const corrections = record.workCompletion?.corrections || []
  const reports = corrections.map(entry => entry.previous || {})
  reports.push(record)
  const seen = new Set()
  return reports.filter(report => report.technicalObservation).map((report, index) => {
    const correction = corrections.find(entry => entry.at === report.technicalReportedAt && String(entry.actor?.id) === String(report.technicalReportedById))
    return { id: String(record.id) + ':' + index, at: report.technicalReportedAt || '', byId: report.technicalReportedById || '',
      byName: report.technicalReportedByName || 'Sin autor registrado', status: report.technicalStatus || report.status || '',
      label: correction ? 'Corrección administrativa' : 'Informe técnico', body: report.technicalObservation }
  }).filter(report => { const key = JSON.stringify([report.at, report.byId, report.body]); if (seen.has(key)) return false; seen.add(key); return true })
}
function ticketServiceObservations(ticket, records, readable) {
  const ids = new Set((ticket.serviceIds || []).map(String))
  return (records || []).filter(record => (ids.has(String(record.id)) || String(record.sourceTicketId || '') === String(ticket.id)) && readable(record))
    .flatMap(record => serviceObservations(record).map(report => ({ ...report, id: 'service-observation:' + report.id,
      sourceTicketId: ticket.id, sourceTicketNumber: ticket.number, sourceServiceId: record.id, kind: 'event', action: 'service-observation',
      visibility: 'public', channel: 'internal', body: report.label + ' · ' + report.status + '\n' + report.body })))
}
module.exports = { serviceObservations, ticketServiceObservations }

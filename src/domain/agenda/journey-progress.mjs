// Original journey identities stay in history; only operational numbering
// excludes cancelled visits. Missing visits are presumed active (partial views).
export function activeJourneyIndexes(record, history = []) {
  if (!record?.serviceJourney) return []
  if (Array.isArray(record.journeyActiveIndexes)) return record.journeyActiveIndexes
  const cancelled = new Set(history.filter(item => item.serviceJourney?.id === record.serviceJourney.id && (item.status === 'Cancelado' || item.technicalStatus === 'Cancelado')).map(item => item.serviceJourney.index))
  return Array.from({ length: record.serviceJourney.total }, (_, index) => index + 1).filter(index => !cancelled.has(index))
}

export function journeyLabel(record, history = []) {
  const indexes = activeJourneyIndexes(record, history)
  const index = indexes.indexOf(record?.serviceJourney?.index)
  return indexes.length > 1 && index >= 0 ? `Jornada ${index + 1} de ${indexes.length}` : ''
}

export function journeyReportType(record, history = []) {
  return activeJourneyIndexes(record, history).some(index => index > record.serviceJourney.index) ? 'Avance registrado' : 'Completado'
}

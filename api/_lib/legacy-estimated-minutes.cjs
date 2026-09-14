const LEGACY_ESTIMATED_MINUTES = 15

const hasService = record => Boolean(String(record?.serviceId || record?.service || '').trim())
const hasValidEstimatedMinutes = record => {
  const minutes = Number(record?.estimatedMinutes)
  return Number.isInteger(minutes) && minutes >= 15 && minutes <= 720
}
const hasMissingEstimatedMinutes = record => record?.estimatedMinutes == null || String(record.estimatedMinutes).trim() === ''

function migrateLegacyServiceRecord(record, forceLegacyDuration = false) {
  if (!record || !hasService(record) || (!forceLegacyDuration && !hasMissingEstimatedMinutes(record))) return { record, changed: false }
  if (Number(record.estimatedMinutes) === LEGACY_ESTIMATED_MINUTES && record.estimatedMinutesCustomized === true) return { record, changed: false }
  return {
    record: { ...record, estimatedMinutes: LEGACY_ESTIMATED_MINUTES, estimatedMinutesCustomized: true },
    changed: true
  }
}

function migrateTeams(teams = [], forceLegacyDuration = false) {
  let changed = 0
  const records = (teams || []).map(team => ({
    ...team,
    tasks: (team?.tasks || []).map(task => {
      const migrated = migrateLegacyServiceRecord(task, forceLegacyDuration)
      if (migrated.changed) changed += 1
      return migrated.record
    })
  }))
  return { records, changed }
}

function migrateLegacyEstimatedMinutes(state = {}, { repairUnidentifiedAgenda = false, protectedDates = [] } = {}) {
  const agenda = state.agenda && typeof state.agenda === 'object' ? state.agenda : {}
  const protectedDateSet = new Set((protectedDates || []).map(String))
  const unidentifiedDailyAgenda = repairUnidentifiedAgenda && !/^\d{4}-\d{2}-\d{2}$/.test(String(agenda.date || '')) && (agenda.teams || []).some(team => (team?.tasks || []).some(hasService))
  const unidentifiedWeeklyDates = new Set(Object.entries(agenda.weekly || {})
    .filter(([date, plan]) => repairUnidentifiedAgenda && !date.startsWith('_') && !/^\d{4}-\d{2}-\d{2}$/.test(date) && (plan?.teams || []).some(team => (team?.tasks || []).some(hasService)))
    .map(([date]) => date))
  const hasUnidentifiedAgenda = unidentifiedDailyAgenda || unidentifiedWeeklyDates.size > 0
  const legacyIdentities = new Set()
  const addIdentities = record => {
    ;[record?.id, record?.historyId, record?.sourceHistoryId, record?.taskId, record?.sourceTaskId]
      .filter(Boolean).forEach(value => legacyIdentities.add(`id:${String(value)}`))
    const composite = [record?.customerId || record?.clientAccount || record?.client, record?.serviceId || record?.service, record?.time || record?.scheduledTime]
      .map(value => String(value || '').trim().toLocaleLowerCase('es-AR')).join('|')
    if (!composite.startsWith('||') && !composite.endsWith('|')) legacyIdentities.add(`record:${composite}`)
  }
  if (unidentifiedDailyAgenda) (agenda.teams || []).forEach(team => (team?.tasks || []).filter(hasService).forEach(addIdentities))
  Object.entries(agenda.weekly || {}).forEach(([date, plan]) => {
    if (unidentifiedWeeklyDates.has(date)) (plan?.teams || []).forEach(team => (team?.tasks || []).filter(hasService).forEach(addIdentities))
  })
  const isLinkedToUnidentifiedAgenda = record => {
    const identities = [record?.id, record?.historyId, record?.sourceHistoryId, record?.taskId, record?.sourceTaskId]
      .filter(Boolean).map(value => `id:${String(value)}`)
    const composite = [record?.customerId || record?.clientAccount || record?.client, record?.serviceId || record?.service, record?.time || record?.scheduledTime]
      .map(value => String(value || '').trim().toLocaleLowerCase('es-AR')).join('|')
    if (!composite.startsWith('||') && !composite.endsWith('|')) identities.push(`record:${composite}`)
    return identities.some(identity => legacyIdentities.has(identity))
  }

  let historyChanged = 0
  const history = (state.history || []).map(record => {
    if (protectedDateSet.has(String(record?.date || ''))) return record
    const migrated = migrateLegacyServiceRecord(record, hasUnidentifiedAgenda && isLinkedToUnidentifiedAgenda(record))
    if (migrated.changed) historyChanged += 1
    return migrated.record
  })
  const daily = protectedDateSet.has(String(agenda.date || ''))
    ? { records: agenda.teams || [], changed: 0 }
    : migrateTeams(agenda.teams, unidentifiedDailyAgenda)
  let agendaChanged = daily.changed
  const weekly = Object.fromEntries(Object.entries(agenda.weekly || {}).map(([key, plan]) => {
    if (key.startsWith('_') || !plan || typeof plan !== 'object') return [key, plan]
    if (protectedDateSet.has(key)) return [key, plan]
    const migrated = migrateTeams(plan.teams, unidentifiedWeeklyDates.has(key))
    agendaChanged += migrated.changed
    return [key, { ...plan, teams: migrated.records }]
  }))

  return {
    state: { ...state, history, agenda: { ...agenda, teams: daily.records, weekly } },
    historyChanged,
    agendaChanged,
    totalChanged: historyChanged + agendaChanged
  }
}

// El navegador aplica esta reparación al hidratar el estado. Las operaciones
// compare-and-swap deben contrastarse contra la misma representación; de otro
// modo, un servicio legado sin duración parece haber sido modificado por otra
// sesión aunque el único cambio real sea, por ejemplo, su dirección.
const stateForOperationComparison = state => migrateLegacyEstimatedMinutes(state, { repairUnidentifiedAgenda: true }).state

module.exports = { LEGACY_ESTIMATED_MINUTES, hasMissingEstimatedMinutes, hasValidEstimatedMinutes, migrateLegacyEstimatedMinutes, migrateLegacyServiceRecord, stateForOperationComparison }

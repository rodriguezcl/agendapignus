const { analyzeNormalization, fingerprint, sortedIds } = require('./normalization-analysis.cjs')
const str = value => value == null ? null : String(value)

// Evidence is descriptive, never an instruction to repair or a vote for a value.
function reconcileNormalization(state, { backups = [], audit = [] } = {}) {
  const analysis = analyzeNormalization(state)
  const review = analysis.issues.filter(issue => issue.severity === 'review')
  const ids = new Set(review.flatMap(issue => [issue.recordId, ...(issue.details.records || []), issue.details.alternativeRecordId]).filter(Boolean))
  const jobs = new Map((state.history || []).map(job => [String(job.id), job]))
  const tasks = new Map()
  for (const job of jobs.values()) if (job.sourceTaskId) {
    const list = tasks.get(String(job.sourceTaskId)) || []
    list.push(String(job.id)); tasks.set(String(job.sourceTaskId), list)
  }
  const evidence = new Map([...ids].map(id => [id, []]))
  const warnings = [], sources = []
  function capture(row, context) {
    if (!row || typeof row !== 'object') return
    const matches = new Set()
    for (const id of [row.historyId, context.kind === 'history' ? row.id : null]) if (id != null && jobs.has(String(id))) matches.add(String(id))
    for (const taskId of [row.sourceTaskId, row.taskId]) for (const id of tasks.get(String(taskId)) || []) matches.add(id)
    if (matches.size > 1) {
      warnings.push({ type: 'ambiguous_identity', source: context.source, path: context.path, recordIds: [...matches].sort() })
      return
    }
    const id = [...matches][0]
    if (!evidence.has(id)) return
    const values = {
      date: str(context.date ?? row.date), time: str(row.time), status: str(row.status),
      customer: str(row.customerId), service_type: str(row.serviceId), team: str(context.teamId ?? row.teamId),
      technicians: context.memberIds !== undefined ? sortedIds(context.memberIds) : Array.isArray(row.technicianIds) ? sortedIds(row.technicianIds) : null
    }
    evidence.get(id).push({ source: context.source, at: context.at || null, path: context.path, kind: context.kind, values })
  }
  function plan(value, date, context) {
    if (!value || !Array.isArray(value.teams)) return
    value.teams.forEach((team, ti) => (team.tasks || []).forEach((task, si) => capture(task, {
      ...context, kind: 'agenda', date, teamId: team.teamId,
      memberIds: task.vehicleControl ? task.technicianIds : team.memberIds,
      path: `${context.path}/teams/${ti}/tasks/${si}`
    })))
  }
  function agenda(value, context) {
    if (!value || typeof value !== 'object') return
    if (value.date) plan(value, value.date, context)
    for (const [date, entry] of Object.entries(value.weekly || {})) if (/^\d{4}-\d{2}-\d{2}$/.test(date)) plan(entry, date, { ...context, path: `${context.path}/weekly/${date}` })
  }
  for (const backup of [...backups].sort((a, b) => a.key.localeCompare(b.key))) {
    let value
    try { value = typeof backup.value === 'string' ? JSON.parse(backup.value) : backup.value } catch { warnings.push({ type: 'unreadable_backup', source: backup.key }); continue }
    if (!value || typeof value !== 'object') { warnings.push({ type: 'unrecognized_backup', source: backup.key }); continue }
    const context = { source: `backup/${backup.key}`, at: value.createdAt || value.repairedAt || null, path: '', kind: 'history' }
    const before = [...evidence.values()].reduce((n, rows) => n + rows.length, 0)
    for (const field of ['history', 'historyBefore', 'currentHistory', 'recovered', 'recoveredAuditRecords']) if (Array.isArray(value[field])) value[field].forEach((row, i) => capture(row, { ...context, path: `${field}/${i}` }))
    if (value.plan && value.date) plan(value.plan, value.date, { ...context, path: 'plan' })
    if (value.agenda) agenda(value.agenda, { ...context, path: 'agenda' })
    for (const [date, entry] of Object.entries(value.plans || {})) plan(entry, date, { ...context, path: `plans/${date}` })
    if (Array.isArray(value.agendaTasks)) value.agendaTasks.forEach((row, i) => capture(row, { ...context, kind: 'agenda', date: value.date, path: `agendaTasks/${i}` }))
    sources.push({ source: context.source, at: context.at, fingerprint: fingerprint(value), matchedOccurrences: [...evidence.values()].reduce((n, rows) => n + rows.length, 0) - before })
  }
  for (const event of [...audit].sort((a, b) => String(a.at).localeCompare(String(b.at)) || String(a.id).localeCompare(String(b.id)))) {
    const context = { source: `audit/${event.id}`, at: event.at, kind: 'history' }
    for (const side of ['before', 'after']) {
      const value = event[side]
      if (event.entity === 'Servicio / historial') capture(value, { ...context, path: side })
      if (['Agenda técnica', 'Agenda del día'].includes(event.entity)) agenda(value, { ...context, path: side })
      if (event.entity === 'Historial técnico' && Array.isArray(value?.records)) value.records.forEach((row, i) => capture(row, { ...context, path: `${side}/records/${i}` }))
    }
  }
  const records = [...ids].sort().map(id => {
    const job = jobs.get(id)
    if (!job) return { recordId: id, classification: 'missing_current_record' }
    const current = { date: str(job.date), time: str(job.time), status: str(job.status), customer: str(job.customerId), service_type: str(job.serviceId), team: str(job.teamId), technicians: sortedIds(job.technicianIds) }
    const relevant = review.filter(issue => issue.recordId === id || issue.details.records?.includes(id) || issue.details.alternativeRecordId === id)
    const fields = new Set(relevant.map(issue => issue.type === 'multiple_weekly_dates' ? 'date' : issue.type.replace(/_mismatch$/, '')).filter(field => field in current))
    const comparisons = {}
    for (const field of [...fields].sort()) {
      const variants = new Map()
      for (const item of evidence.get(id)) {
        if (item.values[field] == null) continue // absent is not proof of an empty value
        const key = fingerprint(item.values[field])
        const variant = variants.get(key) || { value: item.values[field], references: [] }
        variant.references.push({ source: item.source, at: item.at, path: item.path, kind: item.kind })
        variants.set(key, variant)
      }
      const alternatives = [...variants.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, value]) => value)
      const localAlternatives = alternatives.filter(item => item.references.some(ref => ref.source.startsWith('backup/local/')))
      const localHistory = alternatives.filter(item => item.references.some(ref => ref.source.startsWith('backup/local/') && ref.kind === 'history'))
      comparisons[field] = { current: current[field], classification: !alternatives.length ? 'no_evidence' : alternatives.some(item => fingerprint(item.value) !== fingerprint(current[field])) ? 'historical_variants_require_review' : 'corroborated_not_certified',
        localClassification: !localAlternatives.length ? 'no_evidence' : localAlternatives.some(item => fingerprint(item.value) !== fingerprint(current[field])) ? 'historical_variants_require_review' : 'corroborated_not_certified',
        localHistoryClassification: !localHistory.length ? 'no_evidence' : localHistory.some(item => fingerprint(item.value) !== fingerprint(current[field])) ? 'historical_variants_require_review' : 'corroborated_not_certified', alternatives }
    }
    return { recordId: id, issueIds: relevant.map(issue => issue.id).sort(), comparisons, matchedOccurrences: evidence.get(id).length, requiresDecision: true }
  })
  const fieldCounts = {}
  for (const record of records) for (const comparison of Object.values(record.comparisons || {})) fieldCounts[comparison.classification] = (fieldCounts[comparison.classification] || 0) + 1
  const dates = audit.map(event => event.at).filter(Boolean).sort()
  return { sourceFingerprint: analysis.sourceFingerprint, revision: analysis.revision, productionModified: false, readyForCutover: false,
    evidenceFingerprint: fingerprint({ backups, audit }),
    summary: { affectedRecords: records.length, reviewIssues: review.length, unlinkedIssues: review.filter(issue => !issue.recordId && !issue.details.records).length,
      backupSources: backups.length, auditEvents: audit.length, auditEarliest: dates[0] || null, auditLatest: dates.at(-1) || null, fieldCounts, warnings: warnings.length,
      recordsWithoutEvidence: records.filter(record => !record.matchedOccurrences).length },
    sources, warnings, records,
    unresolvedAgendaIssues: review.filter(issue => !issue.recordId && !issue.details.records),
    limitations: ['Repeated snapshots are not independent evidence.', 'Historical variants can be legitimate changes; no value is selected automatically.', 'Missing audit events do not prove absence or deletion.', 'No fuzzy matching by customer, name, date or team number.'] }
}
module.exports = { reconcileNormalization }

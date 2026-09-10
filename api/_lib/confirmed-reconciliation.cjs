const crypto = require('node:crypto')
const { fingerprint, sortedIds } = require('./normalization-analysis.cjs')

const same = (left, right) => fingerprint(left) === fingerprint(right)
const taskMatches = (task, record) => String(task.historyId || '') === String(record.id) ||
  Boolean(record.sourceTaskId && [task.taskId, task.sourceTaskId].some(id => String(id || '') === String(record.sourceTaskId)))
const teamKey = ids => JSON.stringify(sortedIds(ids))
const stableTeamId = (date, ids) => `reconciled-${date}-${crypto.createHash('sha256').update(teamKey(ids)).digest('hex').slice(0, 16)}`

function applyConfirmedReconciliation(state, manifest) {
  const next = structuredClone(state)
  const employees = new Map((next.employees || []).map(employee => [String(employee.id), employee]))
  const history = new Map((next.history || []).map(record => [String(record.id), record]))
  const decisions = manifest.records || []
  if (new Set(decisions.map(item => String(item.id))).size !== decisions.length) throw new Error('El manifiesto contiene decisiones duplicadas.')

  for (const decision of decisions) {
    const record = history.get(String(decision.id))
    if (!record) throw new Error(`No existe el registro confirmado ${decision.id}.`)
    for (const [field, expected] of Object.entries(decision.expected || {})) {
      const actual = field === 'technicianIds' ? (record[field] || []).map(String) : record[field]
      const wanted = field === 'technicianIds' ? expected.map(String) : expected
      if (!same(actual, wanted)) throw new Error(`El registro ${decision.id} cambió en ${field}; se canceló el ensayo.`)
    }
    if (decision.set.technicianIds) {
      const ids = decision.set.technicianIds.map(String)
      for (const id of ids) if (!employees.has(id)) throw new Error(`El técnico ${id} ya no existe.`)
      record.technicianIds = ids
      record.technicians = ids.map(id => employees.get(id).name)
    }
    for (const field of ['date', 'status']) if (decision.set[field] !== undefined) record[field] = decision.set[field]
  }

  const weekly = next.agenda?.weekly || {}
  const moving = decisions.filter(item => item.alignAgenda).map(decision => ({ decision, record: history.get(String(decision.id)), task: null }))
  for (const [date, plan] of Object.entries(weekly)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Array.isArray(plan?.teams)) continue
    let removedFromPlan = false
    for (const team of plan.teams) {
      team.tasks = (team.tasks || []).filter(task => {
        const item = moving.find(entry => taskMatches(task, entry.record))
        if (!item) return true
        removedFromPlan = true
        if (!item.task || date === item.record.date) item.task = structuredClone(task)
        return false
      })
    }
    if (removedFromPlan) plan.teams = plan.teams.filter(team => (team.tasks || []).length || !(team.memberIds || []).length)
  }
  const grouped = new Map()
  for (const item of moving) {
    if (!item.task) throw new Error(`No se encontró una tarjeta de agenda para ${item.record.id}.`)
    const ids = item.record.technicianIds || []
    const grouping = JSON.stringify([item.record.date, teamKey(ids)])
    const group = grouped.get(grouping) || { date: item.record.date, ids, items: [] }
    item.task.historyId = item.record.id
    item.task.status = item.record.status
    if (item.task.vehicleControl) item.task.technicianIds = [...ids]
    group.items.push(item); grouped.set(grouping, group)
  }
  for (const group of grouped.values()) {
    const plan = weekly[group.date]
    if (!plan || !Array.isArray(plan.teams)) throw new Error(`No existe la agenda de destino ${group.date}.`)
    const id = stableTeamId(group.date, group.ids)
    let team = plan.teams.find(team => String(team.teamId) === id)
    if (!team) {
      team = { teamId: id, label: '', memberIds: [...group.ids], members: group.ids.map(employeeId => employees.get(String(employeeId)).name), tasks: [] }
      plan.teams.push(team)
    }
    for (const { record, task } of group.items) {
      record.teamId = id
      team.tasks.push(task)
    }
  }
  const affectedDates = new Set(moving.flatMap(({ decision, record }) => [decision.expected.date, record.date]).filter(Boolean))
  for (const date of affectedDates) {
    const teams = weekly[date]?.teams || []
    teams.forEach((team, index) => {
      team.label = `Equipo ${index + 1}`
      ;(team.tasks || []).sort((a, b) => String(a.time || '').localeCompare(String(b.time || '')) || String(a.historyId || a.taskId || '').localeCompare(String(b.historyId || b.taskId || '')))
        .forEach((task, taskIndex) => { task.order = taskIndex + 1 })
      for (const task of team.tasks || []) {
        const record = history.get(String(task.historyId || ''))
        if (record && moving.some(item => item.record.id === record.id)) record.team = team.label
      }
    })
  }
  return { state: next, changedRecordIds: decisions.filter(item => !same(item.expected, { ...item.expected, ...item.set }) || item.alignAgenda).map(item => String(item.id)),
    affectedDates: [...affectedDates].sort(), manifestFingerprint: fingerprint(manifest) }
}
module.exports = { applyConfirmedReconciliation, stableTeamId }

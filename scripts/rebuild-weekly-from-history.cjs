const taskFromHistory = record => ({
  taskId: record.sourceTaskId || record.taskId || record.id,
  historyId: record.id,
  time: record.time || record.scheduledTime,
  scheduledTime: record.scheduledTime || record.time,
  serviceId: record.serviceId || '',
  service: record.service || '',
  customerId: record.customerId || '',
  client: record.client || '',
  clientAccount: record.clientAccount || record.account || '',
  clientNameAtService: record.clientNameAtService || '',
  address: record.address || '',
  phone: record.phone || '',
  detail: record.detail || '',
  installationZone: record.installationZone || '',
  paymentMethod: record.paymentMethod || '',
  amount: record.amount || '',
  monthlyFee: record.monthlyFee || '',
  form: record.form || '',
  status: record.status || 'Pendiente'
})

const hasTaskData = task => Boolean(task?.historyId || task?.customerId || task?.client || task?.serviceId || task?.service)

const normalizedTaskValue = value => String(value || '').trim().toLocaleLowerCase('es')

const taskOccurrenceKey = task => {
  if (!hasTaskData(task)) return ''
  const customer = normalizedTaskValue(task.customerId || task.clientAccount || task.account || task.client)
  const service = normalizedTaskValue(task.serviceId || task.service)
  const time = normalizedTaskValue(task.time || task.scheduledTime)
  return customer && service && time ? `occurrence:${customer}|${service}|${time}` : ''
}

const taskAliases = task => {
  const time = normalizedTaskValue(task?.time || task?.scheduledTime)
  if (!hasTaskData(task)) return [`blank:${time}`]
  return [
    task?.historyId && `history:${task.historyId}`,
    task?.sourceHistoryId && `history:${task.sourceHistoryId}`,
    task?.taskId && `task:${task.taskId}`,
    task?.sourceTaskId && `task:${task.sourceTaskId}`,
    taskOccurrenceKey(task)
  ].filter(Boolean)
}

const taskKey = task => taskOccurrenceKey(task) ||
  String(task.taskId || task.sourceTaskId || task.historyId || task.sourceHistoryId || '')

function dedupeAgendaTeams(teams = []) {
  const mergedTeams = []
  ;(teams || []).forEach(team => {
    const teamId = String(team.teamId || '')
    const label = String(team.label || '').trim().toLowerCase()
    const index = mergedTeams.findIndex(current =>
      (teamId && String(current.teamId || '') === teamId) ||
      (label && String(current.label || '').trim().toLowerCase() === label)
    )
    if (index < 0) {
      mergedTeams.push({ ...team, memberIds: [...(team.memberIds || [])], members: [...(team.members || [])], tasks: [...(team.tasks || [])] })
      return
    }
    const current = mergedTeams[index]
    mergedTeams[index] = {
      ...current,
      memberIds: [...(current.memberIds || []), ...(team.memberIds || [])].filter((id, memberIndex, all) => all.findIndex(value => String(value) === String(id)) === memberIndex),
      members: [...new Set([...(current.members || []), ...(team.members || [])])],
      tasks: [...(current.tasks || []), ...(team.tasks || [])]
    }
  })
  const seen = new Set()
  return mergedTeams.map(team => ({
    ...team,
    tasks: (team.tasks || []).filter(task => {
      const aliases = taskAliases(task)
      if (aliases.some(alias => seen.has(alias))) return false
      aliases.forEach(alias => seen.add(alias))
      return true
    })
  }))
}

function rebuildWeeklyFromHistory(db, today = new Date().toISOString().slice(0, 10)) {
  const readRows = table => db.prepare(`SELECT data FROM ${table} ORDER BY rowid`).all().map(row => JSON.parse(row.data))
  const agendaRow = db.prepare('SELECT data FROM agendas WHERE id = ?').get('current')
  if (!agendaRow) return { changed: false, dates: 0, tasks: 0 }

  const agenda = JSON.parse(agendaRow.data)
  const history = readRows('work_history').filter(record => /^\d{4}-\d{2}-\d{2}$/.test(String(record.date || '')))
  const employeeById = new Map(readRows('employees').map(employee => [String(employee.id), employee]))
  const recordsByDate = new Map()
  history.forEach(record => {
    if (!recordsByDate.has(record.date)) recordsByDate.set(record.date, [])
    recordsByDate.get(record.date).push(record)
  })

  const weekly = { ...(agenda.weekly || {}) }
  let changedDates = 0
  let generatedTasks = 0

  for (const [date, records] of recordsByDate) {
    const existingTeams = weekly[date]?.teams || []
    const teamRecords = new Map()
    records.forEach((record, index) => {
      const key = String(record.teamId || record.team || `history-team-${index + 1}`)
      if (!teamRecords.has(key)) teamRecords.set(key, [])
      teamRecords.get(key).push(record)
    })

    const generatedTeams = [...teamRecords.entries()].map(([teamId, assignedRecords], index) => {
      const technicianIds = [...new Set(assignedRecords.flatMap(record => record.technicianIds || []).map(String))]
      const technicians = technicianIds.map(id => employeeById.get(id)).filter(Boolean)
      const label = assignedRecords.find(record => /^Equipo\s+\d+/i.test(String(record.team || '')))?.team || `Equipo ${index + 1}`
      const tasks = assignedRecords.map(taskFromHistory)
        .sort((left, right) => left.time.localeCompare(right.time) || taskKey(left).localeCompare(taskKey(right)))
      tasks.forEach((task, taskIndex) => { task.order = taskIndex + 1 })
      generatedTasks += tasks.length
      return { teamId, label, memberIds: technicians.map(employee => employee.id), members: technicians.map(employee => employee.name), tasks }
    })

    let nextTeams = generatedTeams
    if (date >= today) {
      const generatedTaskKeys = new Set(generatedTeams.flatMap(team => team.tasks.map(taskKey)))
      const generatedTeamIds = new Set(generatedTeams.map(team => String(team.teamId)))
      const extrasByTeam = new Map()
      existingTeams.forEach(team => (team.tasks || []).filter(hasTaskData).forEach(task => {
        if (generatedTaskKeys.has(taskKey(task))) return
        const key = String(team.teamId || '')
        if (!extrasByTeam.has(key)) extrasByTeam.set(key, { ...team, tasks: [] })
        extrasByTeam.get(key).tasks.push(task)
      }))
      nextTeams = generatedTeams.map(team => {
        const extra = extrasByTeam.get(String(team.teamId))
        if (!extra?.tasks.length) return team
        const tasks = [...team.tasks, ...extra.tasks].sort((left, right) => String(left.time || '').localeCompare(String(right.time || '')))
        tasks.forEach((task, index) => { task.order = index + 1 })
        extrasByTeam.delete(String(team.teamId))
        return { ...team, tasks }
      })
      extrasByTeam.forEach((team, key) => {
        if (!generatedTeamIds.has(key)) nextTeams.push(team)
      })
    }

    nextTeams = dedupeAgendaTeams(nextTeams)
    const nextPlan = { ...(weekly[date] || {}), teams: nextTeams }
    if (JSON.stringify(nextPlan) !== JSON.stringify(weekly[date])) changedDates += 1
    weekly[date] = nextPlan
  }

  const nextAgenda = { ...agenda, weekly }
  const changed = JSON.stringify(nextAgenda) !== JSON.stringify(agenda)
  if (changed) {
    db.prepare('UPDATE agendas SET data = ? WHERE id = ?').run(JSON.stringify(nextAgenda), 'current')
    const revision = Number(db.prepare('SELECT value FROM preferences WHERE key = ?').get('state_revision')?.value || 0) + 1
    db.prepare('INSERT OR REPLACE INTO preferences (key, value) VALUES (?, ?)').run('state_revision', String(revision))
  }
  return { changed, dates: changedDates, tasks: generatedTasks, totalDates: recordsByDate.size }
}

module.exports = { rebuildWeeklyFromHistory, dedupeAgendaTeams }

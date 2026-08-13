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
  monthlyFee: record.monthlyFee || '',
  form: record.form || '',
  status: record.status || 'Pendiente'
})

const taskKey = task => String(task.historyId || task.sourceHistoryId || '') || [
  String(task.customerId || task.clientAccount || task.client || '').trim().toLowerCase(),
  String(task.serviceId || task.service || '').trim().toLowerCase(),
  task.time || task.scheduledTime || ''
].join('|')

const hasTaskData = task => Boolean(task?.historyId || task?.customerId || task?.client || task?.serviceId || task?.service)

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

module.exports = { rebuildWeeklyFromHistory }

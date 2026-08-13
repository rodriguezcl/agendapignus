const crypto = require('node:crypto')

const VALID_TIME = /^([01]\d|2[0-3]):[0-5]\d$/
const GENERIC_TIMES = ['08:30', '10:00', '11:30', '13:00', '14:30', '16:00', '17:30']

const normalizeText = value => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim()
  .toLowerCase()

const isTechnician = employee => employee.status === 'Activo' && normalizeText(employee.role).includes('tecnico')
const stableTeamId = (date, index) => `team-${crypto.createHash('sha256').update(`${String(date).slice(0, 7)}:${index}`).digest('hex').slice(0, 20)}`

function timeFromLegacyId(id) {
  const match = String(id || '').match(/^\d{4}-\d{2}-\d{2}-\d+-\d+-(\d{2})[:-](\d{2})(?:-|$)/)
  const value = match ? `${match[1]}:${match[2]}` : ''
  return VALID_TIME.test(value) ? value : ''
}

function technicianGroups(employees) {
  const technicians = employees.filter(isTechnician)
  if (!technicians.length) return []
  const groups = []
  for (let index = 0; index < technicians.length; index += 2) groups.push(technicians.slice(index, index + 2))
  return groups
}

function saturdayTechnician(technicians, date) {
  const dayNumber = Math.floor(new Date(`${date}T12:00:00Z`).getTime() / 86_400_000)
  return technicians[Math.abs(dayNumber) % technicians.length]
}

function inferredTeamIndex(record, fallback = 0) {
  const explicit = Number(String(record.team || '').match(/\d+/)?.[0]) - 1
  if (explicit >= 0) return explicit
  return fallback
}

function normalizeScheduling(db) {
  const readRows = table => db.prepare(`SELECT data FROM ${table} ORDER BY rowid`).all().map(row => JSON.parse(row.data))
  const employees = readRows('employees')
  const technicians = employees.filter(isTechnician)
  const employeeById = new Map(employees.map(employee => [String(employee.id), employee]))
  const groups = technicianGroups(employees)
  if (!technicians.length) return { changed: false, history: 0, agendaTasks: 0, teams: 0 }

  let changedHistory = 0
  let changedAgendaTasks = 0
  let changedTeams = 0
  const history = readRows('work_history')
  const recordsByDate = new Map()
  history.forEach(record => {
    const date = String(record.date || 'sin-fecha')
    if (!recordsByDate.has(date)) recordsByDate.set(date, [])
    recordsByDate.get(date).push(record)
  })

  for (const [date, records] of recordsByDate) {
    const isSaturday = /^\d{4}-\d{2}-\d{2}$/.test(date) && new Date(`${date}T12:00:00Z`).getUTCDay() === 6
    const usedTimes = new Map()
    records.forEach(record => {
      const assigned = (record.technicianIds || []).map(id => employeeById.get(String(id))).filter(isTechnician)
      const key = assigned.map(employee => employee.id).sort().join(',') || `unassigned-${inferredTeamIndex(record)}`
      const existingTime = VALID_TIME.test(record.time) ? record.time : (VALID_TIME.test(record.scheduledTime) ? record.scheduledTime : '')
      if (existingTime) {
        if (!usedTimes.has(key)) usedTimes.set(key, new Set())
        usedTimes.get(key).add(existingTime)
      }
    })

    records.forEach((record, recordIndex) => {
      const original = JSON.stringify(record)
      let assigned = (record.technicianIds || []).map(id => employeeById.get(String(id))).filter(isTechnician)
      if (!assigned.length) {
        if (isSaturday) assigned = [saturdayTechnician(technicians, date)]
        else assigned = groups[inferredTeamIndex(record, recordIndex) % groups.length]
      }
      const teamIndex = isSaturday ? 0 : inferredTeamIndex(record, recordIndex % groups.length)
      const key = assigned.map(employee => employee.id).sort().join(',')
      if (!usedTimes.has(key)) usedTimes.set(key, new Set())
      let time = VALID_TIME.test(record.time) ? record.time : (VALID_TIME.test(record.scheduledTime) ? record.scheduledTime : timeFromLegacyId(record.id))
      if (!time) time = GENERIC_TIMES.find(candidate => !usedTimes.get(key).has(candidate)) || GENERIC_TIMES[recordIndex % GENERIC_TIMES.length]
      usedTimes.get(key).add(time)
      record.time = time
      record.scheduledTime = VALID_TIME.test(record.scheduledTime) ? record.scheduledTime : time
      record.technicianIds = assigned.map(employee => employee.id)
      record.technicians = assigned.map(employee => employee.name)
      record.teamId = record.teamId || stableTeamId(date, teamIndex)
      if (!record.team || record.team === 'Histórico importado') record.team = `Equipo ${teamIndex + 1}`
      if (JSON.stringify(record) !== original) changedHistory += 1
    })

    const byTeam = new Map()
    records.forEach(record => {
      const key = String(record.teamId || record.team || '')
      if (!byTeam.has(key)) byTeam.set(key, [])
      byTeam.get(key).push(record)
    })
    byTeam.forEach(teamRecords => teamRecords
      .sort((left, right) => left.time.localeCompare(right.time) || String(left.id).localeCompare(String(right.id)))
      .forEach((record, index) => { record.order = index + 1 }))
  }

  const updateHistory = db.prepare('UPDATE work_history SET data = ? WHERE id = ?')
  history.forEach(record => updateHistory.run(JSON.stringify(record), String(record.id)))

  const agendaRow = db.prepare('SELECT data FROM agendas WHERE id = ?').get('current')
  if (agendaRow) {
    const agenda = JSON.parse(agendaRow.data)
    const normalizeTeams = (teams, date) => {
      const isSaturday = /^\d{4}-\d{2}-\d{2}$/.test(date) && new Date(`${date}T12:00:00Z`).getUTCDay() === 6
      return (teams || []).map((team, teamIndex) => {
        let members = (team.memberIds || []).map(id => employeeById.get(String(id))).filter(isTechnician)
        const hasServices = (team.tasks || []).some(task => task.client || task.service || task.customerId || task.serviceId)
        if (!members.length && hasServices) members = isSaturday ? [saturdayTechnician(technicians, date)] : groups[teamIndex % groups.length]
        if (members.length !== (team.memberIds || []).length) changedTeams += 1
        const used = new Set((team.tasks || []).map(task => VALID_TIME.test(task.time) ? task.time : '').filter(Boolean))
        const tasks = (team.tasks || []).map((task, taskIndex) => {
          const original = JSON.stringify(task)
          const next = { ...task }
          let time = VALID_TIME.test(next.time) ? next.time : (VALID_TIME.test(next.scheduledTime) ? next.scheduledTime : '')
          if (!time) time = GENERIC_TIMES.find(candidate => !used.has(candidate)) || GENERIC_TIMES[taskIndex % GENERIC_TIMES.length]
          used.add(time)
          next.time = time
          next.scheduledTime = VALID_TIME.test(next.scheduledTime) ? next.scheduledTime : time
          if (JSON.stringify(next) !== original) changedAgendaTasks += 1
          return next
        }).sort((left, right) => left.time.localeCompare(right.time))
        tasks.forEach((task, index) => { task.order = index + 1 })
        return { ...team, teamId: team.teamId || stableTeamId(date, teamIndex), memberIds: members.map(employee => employee.id), members: members.map(employee => employee.name), tasks }
      })
    }
    const weekly = Object.fromEntries(Object.entries(agenda.weekly || {}).map(([key, value]) => {
      if (key.startsWith('_')) return [key, value]
      return [key, { ...value, teams: normalizeTeams(value?.teams, key) }]
    }))
    const nextAgenda = { ...agenda, teams: normalizeTeams(agenda.teams, agenda.date), weekly }
    if (JSON.stringify(nextAgenda) !== JSON.stringify(agenda)) db.prepare('UPDATE agendas SET data = ? WHERE id = ?').run(JSON.stringify(nextAgenda), 'current')
  }

  const changed = changedHistory > 0 || changedAgendaTasks > 0 || changedTeams > 0
  if (changed) {
    const revision = Number(db.prepare('SELECT value FROM preferences WHERE key = ?').get('state_revision')?.value || 0) + 1
    db.prepare('INSERT OR REPLACE INTO preferences (key, value) VALUES (?, ?)').run('state_revision', String(revision))
  }
  return { changed, history: changedHistory, agendaTasks: changedAgendaTasks, teams: changedTeams }
}

module.exports = { normalizeScheduling, VALID_TIME }

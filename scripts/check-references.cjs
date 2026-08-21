const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')

const databasePath = path.resolve(process.argv[2] || path.join(__dirname, '..', 'data', 'agenda-tecnica.db'))
const db = new DatabaseSync(databasePath, { readOnly: true })
const rows = table => db.prepare(`SELECT data FROM ${table} ORDER BY rowid`).all().map(row => JSON.parse(row.data))
const customers = rows('customers')
const services = rows('services')
const employees = rows('employees')
const history = rows('work_history')
const reviews = rows('reviews')
const agendaRow = db.prepare('SELECT data FROM agendas WHERE id = ?').get('current')
const agenda = agendaRow ? JSON.parse(agendaRow.data) : {}
const customerIds = new Set(customers.map(customer => String(customer.customerId)))
const serviceIds = new Set(services.map(service => String(service.id)))
const employeeIds = new Set(employees.map(employee => String(employee.id)))
const inconsistencies = []

function checkRecord(record, location, required = false) {
  if ((required && !record.customerId) || (record.customerId && !customerIds.has(String(record.customerId)))) inconsistencies.push({ location, type: 'customer', value: record.customerId || '(vacío)', id: record.id || record.taskId, client: record.client })
  if ((required && !record.serviceId) || (record.serviceId && !serviceIds.has(String(record.serviceId)))) inconsistencies.push({ location, type: 'service', value: record.serviceId || '(vacío)', id: record.id || record.taskId, service: record.service })
  for (const id of record.technicianIds || []) if (!employeeIds.has(String(id))) inconsistencies.push({ location, type: 'technician', value: id, id: record.id || record.taskId })
}

function checkTeams(teams, location) {
  ;(teams || []).forEach((team, teamIndex) => {
    for (const id of team.memberIds || []) if (!employeeIds.has(String(id))) inconsistencies.push({ location: `${location}, equipo ${teamIndex + 1}`, type: 'member', value: id })
    ;(team.tasks || []).forEach((task, taskIndex) => checkRecord(task, `${location}, equipo ${teamIndex + 1}, servicio ${taskIndex + 1}`))
  })
}

history.forEach((record, index) => checkRecord(record, `Historial ${index + 1}`, true))
reviews.forEach((record, index) => checkRecord(record, `Reseña ${index + 1}`))
checkTeams(agenda.teams, 'Agenda del día')
for (const [key, value] of Object.entries(agenda.weekly || {})) {
  if (key === '_monthlyTeams') for (const [month, config] of Object.entries(value || {})) checkTeams(config?.teams, `Equipos mensuales ${month}`)
  else if (!key.startsWith('_')) checkTeams(value?.teams, `Agenda semanal ${key}`)
}

console.log(JSON.stringify({ counts: { customers: customers.length, services: services.length, employees: employees.length, history: history.length, reviews: reviews.length }, inconsistencies }, null, 2))
db.close()
process.exitCode = inconsistencies.length ? 1 : 0

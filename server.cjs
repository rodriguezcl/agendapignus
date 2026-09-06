const http = require('node:http')
const path = require('node:path')
const fs = require('node:fs')
const { validateChangedAgendaSchedules } = require('./api/_lib/scheduling-validation.cjs')
const crypto = require('node:crypto')
const { DatabaseSync } = require('node:sqlite')
const { normalizeScheduling } = require('./scripts/normalize-scheduling.cjs')
const { rebuildWeeklyFromHistory, dedupeAgendaTeams } = require('./scripts/rebuild-weekly-from-history.cjs')
const { writeProfessionalPdf } = require('./scripts/professional-pdf.cjs')
const { fetchNationalHolidays, validHolidayYear } = require('./api/_lib/holidays.cjs')
const { vehicleControlIsOpen, vehicleControlWindowLabel } = require('./api/_lib/vehicle-control-window.cjs')
const { ensureVehicleControlService } = require('./api/_lib/vehicle-control-service.cjs')
const { assertNoPastWeeklyServiceAdditions } = require('./api/_lib/past-agenda.cjs')
const { requestServiceAdvance, resolveServiceAdvance, synchronizeAgendaAdvance } = require('./api/_lib/service-advance.cjs')

// API local: Vite reenvía las rutas /api a este proceso durante el desarrollo.
const port = Number(process.env.PIGNUS_PORT || 3001)
const host = process.env.PIGNUS_HOST || '127.0.0.1'
const dataDir = process.env.PIGNUS_DATA_DIR ? path.resolve(process.env.PIGNUS_DATA_DIR) : path.join(__dirname, 'data')
const publicDir = process.env.PIGNUS_PUBLIC_DIR ? path.resolve(process.env.PIGNUS_PUBLIC_DIR) : path.join(__dirname, 'dist')
const secureCookies = /^(1|true|yes)$/i.test(process.env.PIGNUS_SECURE_COOKIE || '')
fs.mkdirSync(dataDir, { recursive: true })
const db = new DatabaseSync(path.join(dataDir, 'agenda-tecnica.db'))

// Las sesiones viven sólo en memoria: al cerrar el servidor se invalidan todas.
// La cookie contiene un identificador aleatorio, nunca la contraseña ni datos del usuario.
const sessions = new Map()
const loginAttempts = new Map()
const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000
const LOGIN_WINDOW = 15 * 60 * 1000
const LOGIN_MAX_ATTEMPTS = 5
const AUDIT_LOG_LIMIT = 100
const PASSWORD_RESET_REQUESTS_KEY = 'password_reset_requests'
const PASSWORD_RESET_REQUESTS_LIMIT = 50
const CUSTOMER_IMPORT_BACKUP_KEY = 'last_customer_import_backup'
const FEATURE_PERMISSION_PARENTS = {
  weeklyTeams: 'weekly',
  weeklyHours: 'weekly',
  weeklyVehicles: 'weekly',
  weeklyGuards: 'weekly',
  historyManage: 'history',
  accountsEdit: 'accounts',
  accountsDelete: 'accounts',
  accountsImport: 'accounts'
}

// Esquema idempotente: permite iniciar el sistema en una instalación nueva.
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS roles (id TEXT PRIMARY KEY, data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS employees (id TEXT PRIMARY KEY, data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS services (id TEXT PRIMARY KEY, data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS work_history (id TEXT PRIMARY KEY, data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS customers (account TEXT PRIMARY KEY, data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS agendas (id TEXT PRIMARY KEY, data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS preferences (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS audit_log (id TEXT PRIMARY KEY, data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS reviews (id TEXT PRIMARY KEY, data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS vehicle_control_photos (record_id TEXT PRIMARY KEY, vehicle_id TEXT NOT NULL, mime_type TEXT NOT NULL, photo_data BLOB NOT NULL, created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS vehicle_insurance_documents (vehicle_id TEXT PRIMARY KEY, file_name TEXT NOT NULL, pdf_data BLOB NOT NULL, uploaded_at TEXT NOT NULL);
`)

const historicalImportPath = path.join(dataDir, 'historical-import.json')

// Los archivos históricos usaban sólo el primer nombre. Esta normalización
// preserva la trazabilidad al asociarlos con los empleados reales del sistema.
const HISTORICAL_TECHNICIAN_NAMES = {
  Santos: 'Santos Diaz',
  Mariano: 'Mariano Diaz Tillard',
  Pascual: 'Pascual Gonzalez',
  Rodrigo: 'Rodrigo Gonzalez',
  Leonardo: 'Leonardo Rivadero',
  Gonzalo: 'Gonzalo Rivadero'
}

function normalizeHistoryTechnicians(records = []) {
  return records.map(record => {
    const technicians = (record.technicians || []).map(name => HISTORICAL_TECHNICIAN_NAMES[name] || name)
    const changed = technicians.some((name, index) => name !== record.technicians?.[index])
    return changed ? { ...record, technicians } : record
  })
}

// Una agenda puede haberse importado históricamente y luego guardarse desde la
// operación diaria. Para evitar duplicados, la versión operativa (con equipo y
// horario) prevalece sobre la copia de importación del mismo cliente, fecha y servicio.
function historyAccountKey(record = {}) {
  return String(record.clientAccount || record.account || String(record.client || '').trim().split(' ')[0] || '').trim().toUpperCase()
}

function historyServiceKey(record = {}) {
  return String(record.service || '').toLowerCase().replace(/nueva/g, '').replace(/\s+/g, ' ').trim()
}

function removeImportedHistoryDuplicates() {
  const records = rows('work_history')
  const operationalKeys = new Set(records.filter(record => !String(record.id || '').startsWith('import-')).map(record => `${record.date}|${historyAccountKey(record)}|${historyServiceKey(record)}`))
  const redundantIds = records
    .filter(record => String(record.id || '').startsWith('import-'))
    .filter(record => {
      const account = historyAccountKey(record)
      return account && operationalKeys.has(`${record.date}|${account}|${historyServiceKey(record)}`)
    })
    .map(record => String(record.id))

  const remove = db.prepare('DELETE FROM work_history WHERE id = ?')
  redundantIds.forEach(id => remove.run(id))
  return redundantIds.length
}

if (fs.existsSync(historicalImportPath)) {
  db.exec("DELETE FROM work_history WHERE id LIKE 'import-%'")
  const insertHistory = db.prepare('INSERT INTO work_history (id, data) VALUES (?, ?)')
  for (const record of normalizeHistoryTechnicians(JSON.parse(fs.readFileSync(historicalImportPath, 'utf8')))) {
    record.status ||= 'Completado'
    insertHistory.run(String(record.id), JSON.stringify(record))
  }
}

removeImportedHistoryDuplicates()

function rows(table) {
  return db.prepare(`SELECT data FROM ${table} ORDER BY rowid`).all().map(row => JSON.parse(row.data))
}

function recentAuditRows(limit) {
  const records = []
  const auditRows = db.prepare('SELECT id, data FROM audit_log ORDER BY rowid DESC LIMIT ?').all(limit)

  for (const row of auditRows) {
    try {
      const value = JSON.parse(row.data)
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue
      records.push({ ...value, id: value.id || String(row.id) })
    } catch (error) {
      console.warn(`Registro de auditoría inválido (${row.id}): ${error.message}`)
    }
  }

  return records
    .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))
    .map(({ before, after, ...summary }) => summary)
}

function auditRow(id) {
  const row = db.prepare('SELECT id, data FROM audit_log WHERE id = ?').get(String(id))
  if (!row) return null
  try {
    const value = JSON.parse(row.data)
    return value && typeof value === 'object' && !Array.isArray(value) ? { ...value, id: value.id || String(row.id) } : null
  } catch (error) {
    console.warn(`Registro de auditoría inválido (${row.id}): ${error.message}`)
    return null
  }
}

function trimAuditLog() {
  db.prepare('DELETE FROM audit_log WHERE rowid NOT IN (SELECT rowid FROM audit_log ORDER BY rowid DESC LIMIT ?)').run(AUDIT_LOG_LIMIT)
}

trimAuditLog()

// Migra registros históricos que guardaban nombre y apellido en un único campo.
// `name` se conserva como valor derivado para compatibilidad con agendas e historial.
function migrateEmployeeNameParts() {
  const update = db.prepare('UPDATE employees SET data = ? WHERE id = ?')
  for (const employee of rows('employees')) {
    if (employee.firstName && employee.lastName) continue
    const [firstName = '', ...lastNameParts] = String(employee.name || '').trim().split(/\s+/)
    const lastName = lastNameParts.join(' ')
    if (!firstName || !lastName) continue
    update.run(JSON.stringify({ ...employee, firstName, lastName, name: `${firstName} ${lastName}` }), String(employee.id))
  }
}

migrateEmployeeNameParts()

function normalizedRoleName(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()
}

function legacyRoleCode(role) {
  const name = normalizedRoleName(role.name)
  if (name === 'administrador') return 'administrator'
  if (name === 'tecnico') return 'technician'
  if (name === 'coordinador') return 'coordinator'
  if (name === 'usuario') return 'user'
  return `role-${role.id}`
}

// Los nombres pueden editarse. El vínculo y el comportamiento del sistema se
// apoyan en `roleId` y `code`, que permanecen estables aunque cambie la etiqueta.
function migrateRoleReferences() {
  const roles = rows('roles')
  const updateRole = db.prepare('UPDATE roles SET data = ? WHERE id = ?')
  const normalizedRoles = roles.map(role => {
    const next = { ...role, code: role.code || legacyRoleCode(role) }
    if (JSON.stringify(next) !== JSON.stringify(role)) updateRole.run(JSON.stringify(next), String(role.id))
    return next
  })
  const roleByName = new Map(normalizedRoles.map(role => [normalizedRoleName(role.name), role]))
  const roleById = new Map(normalizedRoles.map(role => [String(role.id), role]))
  const updateEmployee = db.prepare('UPDATE employees SET data = ? WHERE id = ?')
  for (const employee of rows('employees')) {
    const matchedRole = roleById.get(String(employee.roleId ?? '')) || roleByName.get(normalizedRoleName(employee.role))
    if (!matchedRole) continue
    const next = { ...employee, roleId: matchedRole.id, role: matchedRole.name }
    if (JSON.stringify(next) !== JSON.stringify(employee)) updateEmployee.run(JSON.stringify(next), String(employee.id))
  }
}

migrateRoleReferences()

function normalizedServiceName(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()
}

function legacyServiceCode(service) {
  return normalizedServiceName(service.name) === 'instalacion de alarma' ? 'alarm-installation' : `service-${service.id}`
}

const normalizeServiceEstimatedMinutes = value => {
  const minutes = Number(value)
  return Number.isInteger(minutes) && minutes >= 15 && minutes <= 720 ? minutes : 60
}

function migrateServiceReferences() {
  const services = rows('services')
  const updateService = db.prepare('UPDATE services SET data = ? WHERE id = ?')
  const normalizedServices = services.map(service => {
    const next = { ...service, code: service.code || legacyServiceCode(service), category: service.category || (normalizedServiceName(service.name).startsWith('instalacion') ? 'installation' : 'service'), estimatedMinutes: normalizeServiceEstimatedMinutes(service.estimatedMinutes) }
    if (JSON.stringify(next) !== JSON.stringify(service)) updateService.run(JSON.stringify(next), String(service.id))
    return next
  })
  const byId = new Map(normalizedServices.map(service => [String(service.id), service]))
  const byName = new Map(normalizedServices.map(service => [normalizedServiceName(service.name), service]))
  const serviceByTerms = terms => normalizedServices.find(service => terms.every(term => normalizedServiceName(service.name).includes(term)))
  const legacyService = value => {
    const name = normalizedServiceName(value)
    if (name.includes('instalacion nueva') && name.includes('camara')) return serviceByTerms(['instalacion', 'camara'])
    if (name.includes('instalacion nueva') && name.includes('cerco')) return serviceByTerms(['instalacion', 'cerco'])
    if (name.includes('service / reparacion') && name.includes('alarma')) return serviceByTerms(['service', 'alarma'])
    if (name.includes('service / reparacion') && name.includes('camara')) return serviceByTerms(['service', 'camara'])
    if (name.includes('service / reparacion') && name.includes('cerco')) return serviceByTerms(['service', 'cerco'])
    if (name.includes('otro') || name.includes('ampliacion / mejora')) return serviceByTerms(['otro'])
    return null
  }
  const normalizeReference = item => {
    const matched = byId.get(String(item.serviceId ?? '')) || byName.get(normalizedServiceName(item.service)) || legacyService(item.service)
    return matched ? { ...item, serviceId: matched.id, service: matched.name, estimatedMinutes: item.estimatedMinutes == null ? matched.estimatedMinutes : item.estimatedMinutes } : item
  }
  const normalizeTeams = teams => (teams || []).map(team => ({ ...team, tasks: (team.tasks || []).map(normalizeReference) }))

  const agendaRow = db.prepare('SELECT data FROM agendas WHERE id = ?').get('current')
  if (agendaRow) {
    const agenda = JSON.parse(agendaRow.data)
    const weekly = Object.fromEntries(Object.entries(agenda.weekly || {}).map(([key, value]) => [key, key.startsWith('_') ? value : { ...value, teams: normalizeTeams(value?.teams) }]))
    const nextAgenda = { ...agenda, teams: normalizeTeams(agenda.teams), weekly }
    if (JSON.stringify(nextAgenda) !== JSON.stringify(agenda)) db.prepare('UPDATE agendas SET data = ? WHERE id = ?').run(JSON.stringify(nextAgenda), 'current')
  }

  const updateHistory = db.prepare('UPDATE work_history SET data = ? WHERE id = ?')
  for (const record of rows('work_history')) {
    const next = normalizeReference(record)
    if (JSON.stringify(next) !== JSON.stringify(record)) updateHistory.run(JSON.stringify(next), String(record.id))
  }
}

migrateServiceReferences()

function normalizedCustomerValue(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/\s+/g, ' ')
}

function legacyCustomerId(customer) {
  const source = String(customer.account || customer.name || crypto.randomUUID()).trim().toUpperCase()
  return `customer-${crypto.createHash('sha256').update(source).digest('hex').slice(0, 24)}`
}

function customerKind(customer) {
  if (customer.kind === 'subscriber' || customer.kind === 'client') return customer.kind
  return String(customer.account || '').toUpperCase().startsWith('PIG-') ? 'subscriber' : 'client'
}

// Los registros anteriores a la validación obligatoria pueden carecer de una
// dirección utilizable. Se reparan una sola vez al iniciar para que no bloqueen
// el resto del estado; las nuevas altas de clientes sí se rechazan incompletas.
function migrateRequiredCustomerFields() {
  const update = db.prepare('UPDATE customers SET data = ? WHERE account = ?')
  for (const customer of rows('customers')) {
    const name = String(customer.name || '').trim() || '-'
    const street = String(customer.street || customer.address || '').trim() || '-'
    const address = String(customer.address || '').trim() || [street, customer.locality, customer.province].filter(Boolean).join(', ')
    const phone = String(customer.phone || '').trim() || '-'
    const next = { ...customer, name, street, address, phone }
    if (JSON.stringify(next) !== JSON.stringify(customer)) update.run(JSON.stringify(next), String(customer.account))
  }
}

migrateRequiredCustomerFields()

function customerCodeFromText(value) {
  const match = String(value || '').toUpperCase().match(/\b(PIG|CLI)[ -]?(\d+)\b/)
  return match ? `${match[1]}-${match[2]}` : ''
}

// PIG identifica a un Abonado; CLI a un Cliente sin abono. La relación real se
// sostiene mediante customerId, que no cambia si se corrige el código o el nombre.
function migrateCustomerReferences() {
  let customers = rows('customers')
  const updateCustomer = db.prepare('UPDATE customers SET data = ? WHERE account = ?')
  let normalizedCustomers = customers.map(customer => {
    const next = { ...customer, customerId: customer.customerId || legacyCustomerId(customer), kind: customerKind(customer) }
    if (JSON.stringify(next) !== JSON.stringify(customer)) updateCustomer.run(JSON.stringify(next), String(customer.account))
    return next
  })
  const agendaRow = db.prepare('SELECT data FROM agendas WHERE id = ?').get('current')
  const agenda = agendaRow ? JSON.parse(agendaRow.data) : null
  const references = [...rows('work_history')]
  const collectTeams = teams => (teams || []).forEach(team => references.push(...(team.tasks || [])))
  collectTeams(agenda?.teams)
  Object.entries(agenda?.weekly || {}).filter(([key]) => !key.startsWith('_')).forEach(([, plan]) => collectTeams(plan?.teams))

  const rebuildIndexes = () => {
    const byId = new Map(normalizedCustomers.map(customer => [String(customer.customerId), customer]))
    const byAccount = new Map()
    normalizedCustomers.forEach(customer => {
      byAccount.set(String(customer.account).trim().toUpperCase(), customer)
      // Una baja cambia PIG por CLI, pero agendas e históricos anteriores pueden
      // seguir usando el código original. Ese código permanece como alias estable.
      if (customer.convertedFromAccount) byAccount.set(String(customer.convertedFromAccount).trim().toUpperCase(), customer)
    })
    const byName = new Map()
    normalizedCustomers.forEach(customer => {
      const key = normalizedCustomerValue(customer.name)
      byName.set(key, byName.has(key) ? null : customer)
    })
    return { byId, byAccount, byName }
  }
  let indexes = rebuildIndexes()
  const corroboratesEmbeddedAccount = (item, target) => {
    const withoutCode = String(item.clientNameAtService || item.client || '').replace(/\bPIG[ -]?\d+\b/i, '').replace(/^[\s\-–—]+/, '')
    const sameName = normalizedCustomerValue(withoutCode) === normalizedCustomerValue(target.name)
    const itemAddress = normalizedCustomerValue(item.address)
    const targetStreet = normalizedCustomerValue(target.street || target.address)
    return sameName || Boolean(itemAddress && targetStreet && (itemAddress.includes(targetStreet) || targetStreet.includes(itemAddress)))
  }
  const matchCustomer = item => {
    const account = String(item.clientAccount || item.account || customerCodeFromText(item.client)).trim().toUpperCase()
    const clientText = normalizedCustomerValue(item.client)
    const embeddedAccount = customerCodeFromText(item.client)
    const embeddedTarget = embeddedAccount.startsWith('PIG-') ? indexes.byAccount.get(embeddedAccount) : null
    if (embeddedTarget && corroboratesEmbeddedAccount(item, embeddedTarget)) return embeddedTarget
    return indexes.byId.get(String(item.customerId || '')) || indexes.byAccount.get(account) ||
      normalizedCustomers.find(customer => normalizedCustomerValue(`${customer.account} ${customer.name}`) === clientText) ||
      indexes.byName.get(normalizedCustomerValue(item.clientNameAtService || item.client))
  }

  // Todo destinatario de un servicio debe existir como entidad. Los registros
  // históricos sin PIG se incorporan como clientes CLI y dejan de depender del texto.
  let nextClientNumber = Math.max(0, ...normalizedCustomers.map(customer => Number(String(customer.account || '').match(/^CLI-(\d+)$/i)?.[1]) || 0)) + 1
  const insertCustomer = db.prepare('INSERT INTO customers (account, data) VALUES (?, ?)')
  const pendingByName = new Map()
  references.forEach(item => {
    if (matchCustomer(item)) return
    const name = String(item.clientNameAtService || item.client || '').replace(/^CLI-\d+\s+/i, '').trim()
    const key = normalizedCustomerValue(name)
    if (!key || key === 'disponible' || pendingByName.has(key)) return
    pendingByName.set(key, item)
  })
  pendingByName.forEach((item, key) => {
    const account = `CLI-${String(nextClientNumber++).padStart(4, '0')}`
    const name = String(item.clientNameAtService || item.client).replace(/^(?:PIG|CLI)-\d+\s+/i, '').trim()
    const address = String(item.address || '').trim()
    const customer = { customerId: legacyCustomerId({ account }), kind: 'client', account, name, type: 'Cliente de servicio', street: address, locality: '', province: '', phone: String(item.phone || '').trim(), address, fields: {} }
    insertCustomer.run(account, JSON.stringify(customer))
    normalizedCustomers.push(customer)
  })
  indexes = rebuildIndexes()
  const normalizeReference = item => {
    const matched = matchCustomer(item)
    const previous = indexes.byId.get(String(item.customerId || ''))
    const reassigned = previous && String(previous.customerId) !== String(matched?.customerId)
    const legacySpacedCode = /\bPIG \d+\b/i.test(String(item.client || '')) && corroboratesEmbeddedAccount(item, matched || {})
    const referencedAccount = String(item.clientAccount || item.account || customerCodeFromText(item.client)).trim().toUpperCase()
    const resolvedAlias = referencedAccount && referencedAccount !== String(matched?.account || '').trim().toUpperCase()
    return matched ? { ...item, customerId: matched.customerId, clientAccount: matched.account, ...(reassigned || legacySpacedCode || resolvedAlias ? { client: `${matched.account} - ${matched.name}`, clientNameAtService: matched.name } : {}) } : item
  }
  const normalizeTeams = teams => (teams || []).map(team => ({ ...team, tasks: (team.tasks || []).map(normalizeReference) }))

  if (agendaRow) {
    const weekly = Object.fromEntries(Object.entries(agenda.weekly || {}).map(([key, value]) => [key, key.startsWith('_') ? value : { ...value, teams: normalizeTeams(value?.teams) }]))
    const nextAgenda = { ...agenda, teams: normalizeTeams(agenda.teams), weekly }
    if (JSON.stringify(nextAgenda) !== JSON.stringify(agenda)) db.prepare('UPDATE agendas SET data = ? WHERE id = ?').run(JSON.stringify(nextAgenda), 'current')
  }
  const updateHistory = db.prepare('UPDATE work_history SET data = ? WHERE id = ?')
  for (const record of rows('work_history')) {
    const next = normalizeReference(record)
    if (JSON.stringify(next) !== JSON.stringify(record)) updateHistory.run(JSON.stringify(next), String(record.id))
  }
  const updateReview = db.prepare('UPDATE reviews SET data = ? WHERE id = ?')
  for (const review of rows('reviews')) {
    const next = normalizeReference(review)
    if (JSON.stringify(next) !== JSON.stringify(review)) updateReview.run(JSON.stringify(next), String(review.id))
  }

  // Consolida clientes CLI creados desde textos históricos que en realidad
  // contienen un código PIG. Para evitar fusiones peligrosas, además del código
  // se exige coincidencia del titular o de la calle registrada.
  const refreshedAgendaRow = db.prepare('SELECT data FROM agendas WHERE id = ?').get('current')
  const referencedCustomerIds = new Set(rows('work_history').map(item => String(item.customerId || '')))
  rows('reviews').forEach(item => item.customerId && referencedCustomerIds.add(String(item.customerId)))
  if (refreshedAgendaRow) {
    const refreshedAgenda = JSON.parse(refreshedAgendaRow.data)
    const collect = teams => (teams || []).forEach(team => (team.tasks || []).forEach(task => task.customerId && referencedCustomerIds.add(String(task.customerId))))
    collect(refreshedAgenda.teams)
    Object.entries(refreshedAgenda.weekly || {}).filter(([key]) => !key.startsWith('_')).forEach(([, plan]) => collect(plan?.teams))
  }
  const subscriberByAccount = new Map(normalizedCustomers.filter(customer => customer.kind === 'subscriber').map(customer => [String(customer.account).toUpperCase(), customer]))
  const removeDuplicate = db.prepare('DELETE FROM customers WHERE account = ?')
  normalizedCustomers.filter(customer => customer.kind === 'client').forEach(customer => {
    const embeddedAccount = customerCodeFromText(customer.name)
    if (!embeddedAccount.startsWith('PIG-')) return
    const subscriber = subscriberByAccount.get(embeddedAccount)
    if (!subscriber) return
    const withoutCode = String(customer.name || '').replace(/\bPIG[ -]?\d+\b/i, '').replace(/^[\s\-–—]+/, '')
    const sameName = normalizedCustomerValue(withoutCode) === normalizedCustomerValue(subscriber.name)
    const clientAddress = normalizedCustomerValue(customer.address)
    const subscriberStreet = normalizedCustomerValue(subscriber.street || subscriber.address)
    const sameAddress = Boolean(clientAddress && subscriberStreet && (clientAddress.includes(subscriberStreet) || subscriberStreet.includes(clientAddress)))
    if ((sameName || sameAddress) && !referencedCustomerIds.has(String(customer.customerId))) removeDuplicate.run(String(customer.account))
  })
}

migrateCustomerReferences()

function mergeDuplicateCliCustomers() {
  const clients = rows('customers').filter(customer => customer.kind === 'client')
  const cleanName = value => normalizedCustomerValue(value)
    .replace(/\b(?:pig|cli)[ -]?\d+\b/g, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/[^a-z0-9ñ]+/g, ' ')
    .trim().replace(/\s+/g, ' ')
  const cleanAddress = value => {
    const normalized = normalizedCustomerValue(value).replace(/[^a-z0-9ñ]+/g, ' ').trim().replace(/\s+/g, ' ')
    return normalized === '-' || normalized.length < 5 ? '' : normalized
  }
  const parent = new Map(clients.map(customer => [String(customer.customerId), String(customer.customerId)]))
  const root = id => { const current = parent.get(id); if (current !== id) parent.set(id, root(current)); return parent.get(id) }
  const join = (left, right) => { const a = root(left), b = root(right); if (a !== b) parent.set(b, a) }
  clients.forEach((left, index) => clients.slice(index + 1).forEach(right => {
    const leftName = cleanName(left.name), rightName = cleanName(right.name)
    const leftAddress = cleanAddress(left.address), rightAddress = cleanAddress(right.address)
    const sameBaseName = leftName && leftName === rightName
    const containedName = leftName.length >= 5 && rightName.length >= 5 && (leftName.includes(rightName) || rightName.includes(leftName))
    const wordDifference = Math.abs(leftName.split(' ').length - rightName.split(' ').length)
    const distinctiveContainedName = containedName && Math.min(leftName.split(' ').length, rightName.split(' ').length) >= 2 && wordDifference <= 1
    const sameAddressAndContainedName = leftAddress && leftAddress === rightAddress && containedName
    if (sameBaseName || distinctiveContainedName || sameAddressAndContainedName) join(String(left.customerId), String(right.customerId))
  }))
  const groups = new Map()
  clients.forEach(customer => { const key = root(String(customer.customerId)); groups.set(key, [...(groups.get(key) || []), customer]) })
  const duplicateGroups = [...groups.values()].filter(group => group.length > 1)
  if (!duplicateGroups.length) return

  const score = customer => (cleanAddress(customer.address) ? 100 : 0) + (String(customer.phone || '').trim() ? 50 : 0) + (!/[()]/.test(customer.name) ? 20 : 0) + (!/\s-\s/.test(customer.name) ? 10 : 0) + String(customer.name || '').length / 100
  const redirects = new Map()
  const updateCustomer = db.prepare('UPDATE customers SET data = ? WHERE account = ?')
  duplicateGroups.forEach(group => {
    const canonical = [...group].sort((a, b) => score(b) - score(a))[0]
    const richestAddress = [...group].sort((a, b) => cleanAddress(b.address).length - cleanAddress(a.address).length)[0]
    const richestPhone = group.find(customer => String(customer.phone || '').trim())
    const merged = { ...canonical, address: cleanAddress(canonical.address) ? canonical.address : richestAddress.address, street: canonical.street || richestAddress.street || richestAddress.address, phone: canonical.phone || richestPhone?.phone || '' }
    updateCustomer.run(JSON.stringify(merged), String(canonical.account))
    group.filter(customer => customer !== canonical).forEach(customer => redirects.set(String(customer.customerId), { target: merged, sourceAccount: customer.account }))
  })
  const redirectReference = item => {
    const target = redirects.get(String(item.customerId || ''))?.target
    return target ? { ...item, customerId: target.customerId, clientAccount: target.account, clientNameAtService: target.name, client: `${target.account} - ${target.name}` } : item
  }
  const redirectTeams = teams => (teams || []).map(team => ({ ...team, tasks: (team.tasks || []).map(redirectReference) }))
  const agendaRow = db.prepare('SELECT data FROM agendas WHERE id = ?').get('current')
  if (agendaRow) {
    const agenda = JSON.parse(agendaRow.data)
    const weekly = Object.fromEntries(Object.entries(agenda.weekly || {}).map(([key, value]) => [key, key.startsWith('_') ? value : { ...value, teams: redirectTeams(value?.teams) }]))
    db.prepare('UPDATE agendas SET data = ? WHERE id = ?').run(JSON.stringify({ ...agenda, teams: redirectTeams(agenda.teams), weekly }), 'current')
  }
  const updateHistory = db.prepare('UPDATE work_history SET data = ? WHERE id = ?')
  rows('work_history').forEach(record => { const next = redirectReference(record); if (next !== record) updateHistory.run(JSON.stringify(next), String(record.id)) })
  const updateReview = db.prepare('UPDATE reviews SET data = ? WHERE id = ?')
  rows('reviews').forEach(review => { const next = redirectReference(review); if (next !== review) updateReview.run(JSON.stringify(next), String(review.id)) })
  const removeCustomer = db.prepare('DELETE FROM customers WHERE account = ?')
  redirects.forEach(({ sourceAccount }) => removeCustomer.run(String(sourceAccount)))
}

mergeDuplicateCliCustomers()

function mergeCliCustomersIntoUniqueSubscribers() {
  const customers = rows('customers')
  const baseName = value => normalizedCustomerValue(value)
    .replace(/\b(?:pig|cli)[ -]?\d+\b/g, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/[^a-z0-9ñ]+/g, ' ')
    .trim().replace(/\s+/g, ' ')
  const comparableAddress = value => normalizedCustomerValue(value)
    .replace(/\b(?:cordoba|capital|argentina)\b/g, '')
    .replace(/[^a-z0-9]+/g, '')
  const subscribersByName = new Map()
  customers.filter(customer => customer.kind === 'subscriber').forEach(customer => {
    const key = baseName(customer.name)
    subscribersByName.set(key, [...(subscribersByName.get(key) || []), customer])
  })
  const redirects = new Map()
  customers.filter(customer => customer.kind === 'client').forEach(customer => {
    let matches = subscribersByName.get(baseName(customer.name)) || []
    if (!matches.length && comparableAddress(customer.address)) {
      const clientName = baseName(customer.name)
      matches = customers.filter(subscriber => subscriber.kind === 'subscriber' && comparableAddress(subscriber.address) === comparableAddress(customer.address) && (baseName(subscriber.name).includes(clientName) || clientName.includes(baseName(subscriber.name))))
    }
    if (matches.length === 1) redirects.set(String(customer.customerId), { target: matches[0], sourceAccount: customer.account })
  })
  if (!redirects.size) return
  const redirectReference = item => {
    const target = redirects.get(String(item.customerId || ''))?.target
    return target ? { ...item, customerId: target.customerId, clientAccount: target.account, clientNameAtService: target.name, client: `${target.account} - ${target.name}` } : item
  }
  const redirectTeams = teams => (teams || []).map(team => ({ ...team, tasks: (team.tasks || []).map(redirectReference) }))
  const agendaRow = db.prepare('SELECT data FROM agendas WHERE id = ?').get('current')
  if (agendaRow) {
    const agenda = JSON.parse(agendaRow.data)
    const weekly = Object.fromEntries(Object.entries(agenda.weekly || {}).map(([key, value]) => [key, key.startsWith('_') ? value : { ...value, teams: redirectTeams(value?.teams) }]))
    db.prepare('UPDATE agendas SET data = ? WHERE id = ?').run(JSON.stringify({ ...agenda, teams: redirectTeams(agenda.teams), weekly }), 'current')
  }
  const updateHistory = db.prepare('UPDATE work_history SET data = ? WHERE id = ?')
  rows('work_history').forEach(record => { const next = redirectReference(record); if (next !== record) updateHistory.run(JSON.stringify(next), String(record.id)) })
  const updateReview = db.prepare('UPDATE reviews SET data = ? WHERE id = ?')
  rows('reviews').forEach(review => { const next = redirectReference(review); if (next !== review) updateReview.run(JSON.stringify(next), String(review.id)) })
  const removeCustomer = db.prepare('DELETE FROM customers WHERE account = ?')
  redirects.forEach(({ sourceAccount }) => removeCustomer.run(String(sourceAccount)))
}

mergeCliCustomersIntoUniqueSubscribers()

function mergeConfirmedCliAliases() {
  const customers = rows('customers')
  const byAccount = new Map(customers.map(customer => [String(customer.account), customer]))
  const confirmedAliases = [
    ['CLI-0004', 'PIG-6302'], // Edificio Canvas / Totem Edificio Canvas, mismo domicilio
    ['CLI-0025', 'PIG-6699'], // Enrique Lascano / Enrique Lascano Allende, mismo domicilio
    ['CLI-0018', 'CLI-0052'], // Totem/Edificio Monviso, misma ubicación
    ['CLI-0056', 'CLI-0032'], // Hugo Wast / La Cuadra, mismo sitio y trabajo
    ['CLI-0035', 'CLI-0058'], // Totem Okra incluido en el registro operativo conjunto
    ['CLI-0059', 'CLI-0047']  // Mantenimiento de cámaras de Costa Verde
  ]
  const redirects = new Map()
  confirmedAliases.forEach(([sourceAccount, targetAccount]) => {
    const source = byAccount.get(sourceAccount), target = byAccount.get(targetAccount)
    if (source && target) redirects.set(String(source.customerId), { target, sourceAccount })
  })
  const confirmedNameAliases = [
    ['HUGO WAST', 'CLI-0032'],
    ['MANTENIMIENTO DE CAMARAS', 'CLI-0047']
  ]
  confirmedNameAliases.forEach(([sourceName, targetAccount]) => {
    const target = byAccount.get(targetAccount)
    customers.filter(customer => customerKind(customer) === 'client' && normalizedCustomerValue(customer.name) === normalizedCustomerValue(sourceName) && customer.account !== targetAccount)
      .forEach(source => { if (target) redirects.set(String(source.customerId), { target, sourceAccount: source.account }) })
  })
  if (!redirects.size) return
  const redirectReference = item => {
    const target = redirects.get(String(item.customerId || ''))?.target
    return target ? { ...item, customerId: target.customerId, clientAccount: target.account, clientNameAtService: target.name, client: `${target.account} - ${target.name}` } : item
  }
  const redirectTeams = teams => (teams || []).map(team => ({ ...team, tasks: (team.tasks || []).map(redirectReference) }))
  const agendaRow = db.prepare('SELECT data FROM agendas WHERE id = ?').get('current')
  if (agendaRow) {
    const agenda = JSON.parse(agendaRow.data)
    const weekly = Object.fromEntries(Object.entries(agenda.weekly || {}).map(([key, value]) => [key, key.startsWith('_') ? value : { ...value, teams: redirectTeams(value?.teams) }]))
    db.prepare('UPDATE agendas SET data = ? WHERE id = ?').run(JSON.stringify({ ...agenda, teams: redirectTeams(agenda.teams), weekly }), 'current')
  }
  const updateHistory = db.prepare('UPDATE work_history SET data = ? WHERE id = ?')
  rows('work_history').forEach(record => { const next = redirectReference(record); if (next !== record) updateHistory.run(JSON.stringify(next), String(record.id)) })
  const updateReview = db.prepare('UPDATE reviews SET data = ? WHERE id = ?')
  rows('reviews').forEach(review => { const next = redirectReference(review); if (next !== review) updateReview.run(JSON.stringify(next), String(review.id)) })
  const removeCustomer = db.prepare('DELETE FROM customers WHERE account = ?')
  redirects.forEach(({ sourceAccount }) => removeCustomer.run(String(sourceAccount)))
}

mergeConfirmedCliAliases()
migrateCustomerReferences()

function convertCompletedRetirementSubscriber(record) {
  if (record.status !== 'Completado' || !normalizedServiceName(record.service).includes('retiro de equipo')) return null
  const customers = rows('customers')
  const customer = customers.find(item => String(item.customerId || '') === String(record.customerId || '')) || customers.find(item => String(item.account || '').toUpperCase() === String(record.clientAccount || '').toUpperCase())
  if (!customer || customerKind(customer) !== 'subscriber') return null
  const nextNumber = Math.max(0, ...customers.map(item => Number(String(item.account || '').match(/^CLI-(\d+)$/i)?.[1]) || 0)) + 1
  const nextAccount = `CLI-${String(nextNumber).padStart(4, '0')}`
  const converted = { ...customer, kind: 'client', account: nextAccount, type: 'Cliente de servicio', convertedFromAccount: customer.account, subscriptionEndedAt: new Date().toISOString() }
  const redirect = item => String(item.customerId || '') === String(customer.customerId) ? { ...item, customerId: customer.customerId, clientAccount: nextAccount, clientNameAtService: converted.name, client: `${nextAccount} ${converted.name}` } : item
  const redirectTeams = teams => (teams || []).map(team => ({ ...team, tasks: (team.tasks || []).map(redirect) }))
  const agendaRow = db.prepare('SELECT data FROM agendas WHERE id = ?').get('current')
  if (agendaRow) {
    const agenda = JSON.parse(agendaRow.data)
    const weekly = Object.fromEntries(Object.entries(agenda.weekly || {}).map(([key, value]) => [key, key.startsWith('_') ? value : { ...value, teams: redirectTeams(value?.teams) }]))
    db.prepare('UPDATE agendas SET data = ? WHERE id = ?').run(JSON.stringify({ ...agenda, teams: redirectTeams(agenda.teams), weekly }), 'current')
  }
  const updateHistory = db.prepare('UPDATE work_history SET data = ? WHERE id = ?')
  rows('work_history').forEach(item => { const next = redirect(item); if (next !== item) updateHistory.run(JSON.stringify(next), String(item.id)) })
  const updateReview = db.prepare('UPDATE reviews SET data = ? WHERE id = ?')
  rows('reviews').forEach(item => { const next = redirect(item); if (next !== item) updateReview.run(JSON.stringify(next), String(item.id)) })
  db.prepare('DELETE FROM customers WHERE account = ?').run(String(customer.account))
  db.prepare('INSERT INTO customers (account, data) VALUES (?, ?)').run(nextAccount, JSON.stringify(converted))
  return converted
}

function stableTeamId(month, index) {
  return `team-${crypto.createHash('sha256').update(`${month}:${index}`).digest('hex').slice(0, 20)}`
}

function migrateTeamAndTechnicianReferences() {
  const employees = rows('employees')
  const employeeById = new Map(employees.map(employee => [String(employee.id), employee]))
  const employeeByName = new Map(employees.map(employee => [normalizedCustomerValue(employee.name), employee]))
  const normalizeMembers = team => {
    const matched = (team.memberIds || []).map(id => employeeById.get(String(id))).filter(Boolean)
    const fromNames = (team.members || []).map(name => employeeByName.get(normalizedCustomerValue(name))).filter(Boolean)
    const assigned = [...new Map([...matched, ...fromNames].map(employee => [String(employee.id), employee])).values()]
    return { ...team, memberIds: assigned.map(employee => employee.id), members: assigned.map(employee => employee.name) }
  }
  const normalizeTeams = (teams, month) => (teams || []).map((team, index) => ({ ...normalizeMembers(team), teamId: team.teamId || stableTeamId(month, index) }))
  const agendaRow = db.prepare('SELECT data FROM agendas WHERE id = ?').get('current')
  if (agendaRow) {
    const agenda = JSON.parse(agendaRow.data)
    const weekly = { ...(agenda.weekly || {}) }
    weekly._monthlyTeams = Object.fromEntries(Object.entries(weekly._monthlyTeams || {}).map(([month, config]) => [month, { ...config, teams: normalizeTeams(config?.teams, month) }]))
    Object.entries(weekly).filter(([key]) => !key.startsWith('_')).forEach(([day, plan]) => { weekly[day] = { ...plan, teams: normalizeTeams(plan?.teams, day.slice(0, 7)) } })
    const nextAgenda = { ...agenda, teams: normalizeTeams(agenda.teams, String(agenda.date || '').slice(0, 7)), weekly }
    if (JSON.stringify(nextAgenda) !== JSON.stringify(agenda)) db.prepare('UPDATE agendas SET data = ? WHERE id = ?').run(JSON.stringify(nextAgenda), 'current')
  }
  const updateHistory = db.prepare('UPDATE work_history SET data = ? WHERE id = ?')
  for (const record of rows('work_history')) {
    const technicians = (record.technicianIds || []).map(id => employeeById.get(String(id))).filter(Boolean)
    const named = (record.technicians || []).map(name => employeeByName.get(normalizedCustomerValue(name))).filter(Boolean)
    const assigned = [...new Map([...technicians, ...named].map(employee => [String(employee.id), employee])).values()]
    const teamIndex = Number(String(record.team || '').match(/\d+/)?.[0]) - 1
    const teamId = record.teamId ?? (teamIndex >= 0 && record.date ? stableTeamId(String(record.date).slice(0, 7), teamIndex) : null)
    const next = { ...record, teamId, technicianIds: assigned.map(employee => employee.id), technicians: assigned.map(employee => employee.name) }
    if (JSON.stringify(next) !== JSON.stringify(record)) updateHistory.run(JSON.stringify(next), String(record.id))
  }
}

migrateTeamAndTechnicianReferences()
normalizeScheduling(db)
rebuildWeeklyFromHistory(db)

const agendaAfterRebuild = db.prepare('SELECT data FROM agendas WHERE id = ?').get('current')
if (agendaAfterRebuild) {
  const agenda = JSON.parse(agendaAfterRebuild.data)
  const teams = dedupeAgendaTeams(agenda.teams)
  if (JSON.stringify(teams) !== JSON.stringify(agenda.teams)) db.prepare('UPDATE agendas SET data = ? WHERE id = ?').run(JSON.stringify({ ...agenda, teams }), 'current')
}

function auditSafe(record) {
  if (!record) return null
  const { password, passwordHash, ...safe } = record
  return safe
}

function writeAudit(user, action, entity, entityId, before, after) {
  const entry = { id: crypto.randomUUID(), at: new Date().toISOString(), user: { id: user.id, name: user.name, email: user.email, role: user.role }, action, entity, entityId, before: auditSafe(before), after: auditSafe(after) }
  db.prepare('INSERT INTO audit_log (id, data) VALUES (?, ?)').run(entry.id, JSON.stringify(entry))
  trimAuditLog()
}

function passwordResetRequests() {
  const row = db.prepare('SELECT value FROM preferences WHERE key = ?').get(PASSWORD_RESET_REQUESTS_KEY)
  try {
    const requests = JSON.parse(row?.value || '[]')
    return Array.isArray(requests) ? requests.filter(item => item?.id && item?.email && item?.requestedAt) : []
  } catch {
    return []
  }
}

function savePasswordResetRequests(requests) {
  db.prepare('INSERT OR REPLACE INTO preferences (key, value) VALUES (?, ?)').run(PASSWORD_RESET_REQUESTS_KEY, JSON.stringify(requests.slice(0, PASSWORD_RESET_REQUESTS_LIMIT)))
}

function auditChanges(table, records, key, entity, user) {
  const storedRecords = Array.isArray(table) ? table : rows(table)
  const previous = new Map(storedRecords.map(record => [String(record[key]), record]))
  const incoming = new Map((records || []).map(record => [String(record[key]), record]))
  for (const [id, record] of incoming) {
    const old = previous.get(id)
    if (!old) writeAudit(user, 'Creó', entity, id, null, record)
    else if (JSON.stringify(auditSafe(old)) !== JSON.stringify(auditSafe(record))) writeAudit(user, 'Modificó', entity, id, old, record)
  }
  for (const [id, record] of previous) if (!incoming.has(id)) writeAudit(user, 'Eliminó', entity, id, record, null)
}

/** Devuelve el estado completo que consume la interfaz React al iniciar. */
function readState() {
  const agenda = db.prepare('SELECT data FROM agendas WHERE id = ?').get('current')
  const theme = db.prepare('SELECT value FROM preferences WHERE key = ?').get('theme')
  const storedVehicles = db.prepare('SELECT value FROM preferences WHERE key = ?').get('vehicles')
  let vehicles = []
  try { const parsed = JSON.parse(storedVehicles?.value || '[]'); vehicles = Array.isArray(parsed) ? parsed : [] } catch { vehicles = [] }
  return {
    revision: currentStateRevision(),
    roles: rows('roles'),
    // Nunca se exponen hashes ni contraseñas a la interfaz.
    employees: sanitizeEmployeesForRead(),
    services: rows('services'),
    vehicles,
    history: rows('work_history'),
    customers: rows('customers'),
    reviews: rows('reviews'),
    agenda: agenda ? JSON.parse(agenda.data) : null,
    preferences: theme ? { theme: theme.value } : {}
  }
}

function technicianSafeRecord(record = {}) {
  const { internalNote: _internalNote, internalChecklist: _internalChecklist, monthlyFee: _monthlyFee, ...visible } = record
  const cashPayment = normalizedRoleName(visible.paymentMethod) === 'efectivo'
  const handwrittenForm = normalizedRoleName(visible.form).startsWith('incompleto')
  if (!cashPayment) {
    delete visible.paymentMethod
    delete visible.amount
  }
  if (!handwrittenForm) delete visible.form
  return visible
}

function internalPlanningIsValid(record = {}) {
  const checklist = record.internalChecklist
  return String(record.internalNote || '').length <= 5000 &&
    (checklist == null || (Array.isArray(checklist) && checklist.length <= 30 && checklist.every(item => item && typeof item === 'object' && String(item.text || '').length <= 500 && typeof item.completed === 'boolean')))
}

function readTechnicianState(user) {
  const technicianId = String(user.id)
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date())
  const history = rows('work_history')
  const assignedHistory = history.filter(record => record.technicianIds?.some(id => String(id) === technicianId))
  const activeAssigned = assignedHistory.filter(record => String(record.date || '') >= today && !record.technicalStatus && !['Completado', 'Cancelado', 'Reprogramado'].includes(record.status))
  const activeCustomerIds = new Set(activeAssigned.map(record => String(record.customerId || '')).filter(Boolean))
  const activeCustomerAccounts = new Set(activeAssigned.map(record => String(record.clientAccount || String(record.client || '').trim().split(/\s+/)[0] || '').trim().toUpperCase()).filter(Boolean))
  return {
    revision: currentStateRevision(),
    roles: [], employees: [], services: [], vehicles: readState().vehicles || [], customers: [], agenda: null, preferences: {},
    // El nombre es solamente una etiqueta visible. El acceso se decide siempre
    // mediante el identificador inmutable del empleado autenticado.
    history: history.filter(record => {
      if (record.technicianIds?.some(id => String(id) === technicianId)) return true
      const customerId = String(record.customerId || '')
      const account = String(record.clientAccount || String(record.client || '').trim().split(/\s+/)[0] || '').trim().toUpperCase()
      return (customerId && activeCustomerIds.has(customerId)) || (account && activeCustomerAccounts.has(account))
    }).map(technicianSafeRecord)
  }
}

function readStateForUser(user) {
  if (user.roleCode === 'technician') return readTechnicianState(user)
  const state = readState()
  const { reviews: retiredReviews, ...visibleState } = state
  if (user.roleCode === 'administrator') return { ...visibleState, services: ensureVehicleControlService(state.services) }
  const canPlan = userCan(user, 'agenda') || userCan(user, 'weekly')
  return {
    ...visibleState,
    employees: userCan(user, 'employees') ? state.employees : state.employees.map(({ id, firstName, lastName, name, roleId, role, status }) => ({ id, firstName, lastName, name, roleId, role, status })),
    services: userCan(user, 'services') || canPlan || userCan(user, 'history') ? ensureVehicleControlService(state.services) : [],
    vehicles: userCan(user, 'vehicles') || userCan(user, 'weeklyVehicles') ? state.vehicles : [],
    customers: userCan(user, 'accounts') || canPlan || userCan(user, 'history') ? state.customers : [],
    history: userCan(user, 'history') || userCan(user, 'accounts') ? state.history : [],
    agenda: canPlan ? state.agenda : null
  }
}

function currentStateRevision() {
  return Number(db.prepare('SELECT value FROM preferences WHERE key = ?').get('state_revision')?.value || 0)
}

function roleForEmployee(employee) {
  return rows('roles').find(role => String(role.id) === String(employee?.roleId)) ||
    rows('roles').find(role => normalizedRoleName(role.name) === normalizedRoleName(employee?.role))
}

function userCan(user, permission) {
  if (user?.roleCode === 'administrator') return true
  const parent = FEATURE_PERMISSION_PARENTS[permission]
  if (parent && user?.permissions?.[parent] !== true) return false
  if (typeof user?.permissions?.[permission] === 'boolean') return user.permissions[permission]
  return false
}

function planningHistoryForAgenda(incomingHistory = [], currentHistory = [], agenda = {}) {
  const linked = new Set()
  const removed = new Set()
  const inspectPlan = plan => {
    ;(plan?.removedTaskIds || []).forEach(id => removed.add(String(id)))
    ;(plan?.teams || []).forEach(team => (team.tasks || []).forEach(task => {
      if (task.historyId) linked.add(String(task.historyId))
      if (task.taskId) linked.add(String(task.taskId))
    }))
  }
  inspectPlan({ teams: agenda.teams || [] })
  Object.entries(agenda.weekly || {}).forEach(([key, value]) => { if (!key.startsWith('_')) inspectPlan(value) })
  const incomingById = new Map(incomingHistory.map(record => [String(record.id), record]))
  const protectedFields = ['status', 'technicalStatus', 'technicalObservation', 'technicalReportedAt', 'technicalReportedById', 'technicalReportedByName', 'completedAt', 'advanceRequest', 'originalScheduledTime']
  const result = []
  for (const previous of currentHistory) {
    const id = String(previous.id)
    const sourceTaskId = String(previous.sourceTaskId || '')
    const proposed = incomingById.get(id)
    const closed = ['Completado', 'Cancelado', 'Reprogramado'].includes(previous.status) || Boolean(previous.technicalStatus)
    if (!proposed) {
      if (!closed && (removed.has(id) || (sourceTaskId && removed.has(sourceTaskId)))) continue
      result.push(previous)
      continue
    }
    incomingById.delete(id)
    if (closed || (!linked.has(id) && !(sourceTaskId && linked.has(sourceTaskId)))) { result.push(previous); continue }
    const next = { ...proposed }
    protectedFields.forEach(field => {
      if (previous[field] == null || previous[field] === '') delete next[field]
      else next[field] = previous[field]
    })
    next.status = previous.status || 'Pendiente'
    result.push(next)
  }
  for (const proposed of incomingById.values()) {
    const id = String(proposed.id)
    const sourceTaskId = String(proposed.sourceTaskId || '')
    if (!linked.has(id) && !(sourceTaskId && linked.has(sourceTaskId))) continue
    const next = { ...proposed, status: 'Pendiente' }
    protectedFields.filter(field => field !== 'status').forEach(field => { delete next[field] })
    result.push(next)
  }
  return result
}

// La interfaz conserva un estado amplio, pero el servidor nunca acepta cambios
// sobre colecciones para las que el rol autenticado no tiene permiso.
function authorizedIncomingState(state, user) {
  const current = readState()
  const administrator = user?.roleCode === 'administrator'
  const canPlan = userCan(user, 'agenda') || userCan(user, 'weekly')
  let employees = current.employees
  if (administrator) employees = state.employees
  else if (userCan(user, 'employees')) {
    const previousById = new Map(current.employees.map(employee => [String(employee.id), employee]))
    const administratorRoleIds = new Set(current.roles.filter(role => (role.code || legacyRoleCode(role)) === 'administrator').map(role => String(role.id)))
    employees = (state.employees || []).map(employee => {
      const previous = previousById.get(String(employee.id))
      if (previous && administratorRoleIds.has(String(previous.roleId))) return previous
      if (!previous && administratorRoleIds.has(String(employee.roleId))) {
        const error = new Error('Solamente un administrador puede crear o asignar cuentas administrativas.')
        error.statusCode = 403
        throw error
      }
      return previous ? { ...employee, roleId: previous.roleId, role: previous.role } : employee
    })
    current.employees.filter(employee => administratorRoleIds.has(String(employee.roleId)) && !employees.some(item => String(item.id) === String(employee.id))).forEach(employee => employees.push(employee))
  }
  const currentAgenda = current.agenda || {}
  const incomingAgenda = state.agenda || {}
  const { _holidayOverrides: ignoredHolidayOverrides, _annualGuards: ignoredAnnualGuards, _monthlyTeams: ignoredMonthlyTeams, ...incomingWeeklyWithoutProtectedConfiguration } = incomingAgenda.weekly || {}
  const currentMonthly = currentAgenda.weekly?._monthlyTeams || {}
  const incomingMonthly = incomingAgenda.weekly?._monthlyTeams || {}
  const protectedMonthly = Object.fromEntries([...new Set([...Object.keys(currentMonthly), ...Object.keys(incomingMonthly)])].map(month => {
    const previous = currentMonthly[month] || {}
    const proposed = incomingMonthly[month] || {}
    const canConfigureAnything = ['weeklyTeams', 'weeklyHours', 'weeklyVehicles'].some(permission => userCan(user, permission))
    return [month, {
      ...previous,
      ...(userCan(user, 'weeklyTeams') ? { teams: proposed.teams ?? previous.teams } : {}),
      ...(userCan(user, 'weeklyHours') ? { defaultTimes: proposed.defaultTimes ?? previous.defaultTimes, defaultTimePeriods: proposed.defaultTimePeriods ?? previous.defaultTimePeriods } : {}),
      ...(userCan(user, 'weeklyVehicles') ? { vehicleAssignments: proposed.vehicleAssignments ?? previous.vehicleAssignments } : {}),
      ...(canConfigureAnything && proposed.configurationHistory ? { configurationHistory: proposed.configurationHistory } : {})
    }]
  }))
  const protectedWeekly = administrator ? incomingAgenda.weekly : {
    ...incomingWeeklyWithoutProtectedConfiguration,
    ...(currentAgenda.weekly?._holidayOverrides ? { _holidayOverrides: currentAgenda.weekly._holidayOverrides } : {}),
    ...(userCan(user, 'weeklyGuards') ? (incomingAgenda.weekly?._annualGuards ? { _annualGuards: incomingAgenda.weekly._annualGuards } : {}) : (currentAgenda.weekly?._annualGuards ? { _annualGuards: currentAgenda.weekly._annualGuards } : {})),
    ...(Object.keys(protectedMonthly).length ? { _monthlyTeams: protectedMonthly } : {})
  }
  const agenda = {
    ...currentAgenda,
    ...(userCan(user, 'agenda') ? { date: incomingAgenda.date, teams: incomingAgenda.teams } : {}),
    ...(userCan(user, 'weekly') ? { weekly: protectedWeekly } : {})
  }
  const existingCustomerIds = new Set((current.customers || []).map(customer => String(customer.customerId)))
  const planningCustomers = canPlan ? [...(current.customers || []), ...(state.customers || []).filter(customer => !existingCustomerIds.has(String(customer.customerId)) && customerKind(customer) === 'client')] : current.customers
  let customers = planningCustomers
  if (userCan(user, 'accountsEdit')) {
    const proposedById = new Map((state.customers || []).map(customer => [String(customer.customerId), customer]))
    customers = (current.customers || []).map(customer => proposedById.get(String(customer.customerId)) || customer)
    ;(state.customers || []).filter(customer => !existingCustomerIds.has(String(customer.customerId))).forEach(customer => customers.push(customer))
  }
  if (userCan(user, 'accountsDelete')) {
    const incomingIds = new Set((state.customers || []).map(customer => String(customer.customerId)))
    customers = customers.filter(customer => !existingCustomerIds.has(String(customer.customerId)) || incomingIds.has(String(customer.customerId)))
  }
  const planningHistory = canPlan ? planningHistoryForAgenda(state.history || [], current.history || [], incomingAgenda) : current.history
  return {
    ...state,
    roles: administrator ? state.roles : current.roles,
    employees,
    services: userCan(user, 'services') ? state.services : current.services,
    vehicles: userCan(user, 'vehicles') && Array.isArray(state.vehicles) ? state.vehicles : current.vehicles,
    history: userCan(user, 'historyManage') ? state.history : planningHistory,
    customers,
    // El módulo fue retirado. Sus registros históricos se conservan internamente
    // y nunca se reemplazan con datos provenientes de la interfaz.
    reviews: current.reviews,
    agenda
  }
}

function replaceRows(table, records, key) {
  // Sincronización diferencial: evita borrar y recrear cientos de registros
  // cuando el usuario sólo modificó un servicio, empleado o cliente.
  const existing = new Map(db.prepare(`SELECT ${key}, data FROM ${table}`).all().map(row => [String(row[key]), row.data]))
  const upsert = db.prepare(`INSERT OR REPLACE INTO ${table} (${key}, data) VALUES (?, ?)`)
  const remove = db.prepare(`DELETE FROM ${table} WHERE ${key} = ?`)
  for (const record of records || []) {
    const recordKey = String(record[key])
    const serialized = JSON.stringify(record)
    if (existing.get(recordKey) !== serialized) upsert.run(recordKey, serialized)
    existing.delete(recordKey)
  }
  for (const recordKey of existing.keys()) remove.run(recordKey)
}

/** Guarda todas las entidades dentro de una transacción para evitar estados parciales. */
function validateState(state, previousState = null) {
  if (!state || typeof state !== 'object') throw new Error('El estado recibido no es válido.')

  const collections = ['roles', 'employees', 'services', 'vehicles', 'customers', 'history']
  collections.forEach(name => {
    if (!Array.isArray(state[name])) throw new Error(`La colección ${name} no es válida.`)
  })

  const ensureUnique = (items, key, label) => {
    const values = new Set()
    items.forEach((item, index) => {
      const value = String(item?.[key] ?? '').trim()
      if (!value) throw new Error(`${label} ${index + 1}: falta ${key}.`)
      const normalized = value.toLocaleLowerCase('es-AR')
      if (values.has(normalized)) throw new Error(`No puede haber ${label.toLowerCase()}s duplicados.`)
      values.add(normalized)
    })
  }
  const text = (value, limit) => String(value ?? '').trim().length <= limit
  const email = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value ?? '').trim())
  const date = value => !value || /^\d{4}-\d{2}-\d{2}$/.test(String(value))
  const time = value => !value || /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value))

  ensureUnique(state.roles, 'id', 'Rol')
  ensureUnique(state.roles, 'code', 'Código de rol')
  ensureUnique(state.employees, 'id', 'Empleado')
  ensureUnique(state.services, 'id', 'Tipo de servicio')
  ensureUnique(state.services, 'code', 'Código de servicio')
  ensureUnique(state.vehicles, 'id', 'Vehículo')
  ensureUnique(state.vehicles, 'plate', 'Matrícula')
  ensureUnique(state.customers, 'customerId', 'Cliente')
  ensureUnique(state.customers, 'account', 'Cliente')
  ensureUnique(state.history, 'id', 'Registro de historial')

  const roleIds = new Set(state.roles.map(role => String(role.id)))
  const employeeIds = new Set(state.employees.map(employee => String(employee.id)))
  const serviceIds = new Set(state.services.map(service => String(service.id)))
  const customerIds = new Set(state.customers.map(customer => String(customer.customerId)))
  state.roles.forEach((role, index) => {
    if (!String(role.name ?? '').trim() || !text(role.name, 80) || !String(role.code ?? '').trim() || !text(role.code, 80) || typeof role.permissions !== 'object' || !role.permissions) throw new Error(`Rol ${index + 1}: datos incompletos.`)
  })
  state.employees.forEach((employee, index) => {
    if (!String(employee.firstName ?? '').trim() || !text(employee.firstName, 80)) throw new Error(`Empleado ${index + 1}: el nombre es obligatorio.`)
    if (!String(employee.lastName ?? '').trim() || !text(employee.lastName, 120)) throw new Error(`Empleado ${index + 1}: el apellido es obligatorio.`)
    if (`${employee.firstName} ${employee.lastName}`.trim() !== String(employee.name || '').trim() || !text(employee.name, 200)) throw new Error(`Empleado ${index + 1}: el nombre completo no coincide.`)
    if (!email(employee.email) || !text(employee.email, 160)) throw new Error(`Empleado ${index + 1}: el correo electrónico no es válido.`)
    if (!roleIds.has(String(employee.roleId ?? ''))) throw new Error(`Empleado ${index + 1}: debe tener un rol válido.`)
    if (!['Activo', 'Inactivo'].includes(employee.status)) throw new Error(`Empleado ${index + 1}: el estado no es válido.`)
    if (!text(employee.phone, 50)) throw new Error(`Empleado ${index + 1}: el teléfono es demasiado extenso.`)
  })
  ensureUnique(state.employees.map(employee => ({ email: employee.email })), 'email', 'Correo electrónico')
  state.services.forEach((service, index) => {
    if (!String(service.name ?? '').trim() || !text(service.name, 120) || !String(service.code ?? '').trim() || !text(service.code, 120)) throw new Error(`Tipo de servicio ${index + 1}: nombre o código inválido.`)
    if (!text(service.description, 500)) throw new Error(`Tipo de servicio ${index + 1}: la descripción es demasiado extensa.`)
    if (!Number.isInteger(Number(service.estimatedMinutes)) || Number(service.estimatedMinutes) < 15 || Number(service.estimatedMinutes) > 720) throw new Error(`Tipo de servicio ${index + 1}: el tiempo estimado debe estar entre 15 minutos y 12 horas.`)
    if (!['Activo', 'Inactivo'].includes(service.status)) throw new Error(`Tipo de servicio ${index + 1}: el estado no es válido.`)
  })
  const maximumVehicleYear = new Date().getFullYear() + 1
  state.vehicles.forEach((vehicle, index) => {
    if (!String(vehicle.brand ?? '').trim() || !text(vehicle.brand, 80)) throw new Error(`Vehículo ${index + 1}: la marca es obligatoria o demasiado extensa.`)
    if (!String(vehicle.model ?? '').trim() || !text(vehicle.model, 120)) throw new Error(`Vehículo ${index + 1}: el modelo es obligatorio o demasiado extenso.`)
    if (!Number.isInteger(Number(vehicle.year)) || Number(vehicle.year) < 1886 || Number(vehicle.year) > maximumVehicleYear) throw new Error(`Vehículo ${index + 1}: el año no es válido.`)
    if (vehicle.mileage != null && (!Number.isInteger(Number(vehicle.mileage)) || Number(vehicle.mileage) < 0 || Number(vehicle.mileage) > 99999999)) throw new Error(`Vehículo ${index + 1}: el kilometraje no es válido.`)
    if (!String(vehicle.plate ?? '').trim() || !text(vehicle.plate, 20)) throw new Error(`Vehículo ${index + 1}: la matrícula es obligatoria o demasiado extensa.`)
    if (vehicle.insuranceExpiresOn && !/^\d{4}-\d{2}-\d{2}$/.test(String(vehicle.insuranceExpiresOn))) throw new Error(`Vehículo ${index + 1}: la fecha de vencimiento del seguro no es válida.`)
    if (!text(vehicle.insuranceFileName, 180)) throw new Error(`Vehículo ${index + 1}: el nombre del archivo de seguro es demasiado extenso.`)
  })
  state.customers.forEach((customer, index) => {
    if (!String(customer.name ?? '').trim() || !text(customer.name, 180)) throw new Error(`Cliente ${index + 1}: el titular es obligatorio.`)
    if (!String(customer.address ?? '').trim() || !String(customer.street ?? '').trim()) throw new Error(`Cliente ${index + 1}: la dirección es obligatoria.`)
    if (!String(customer.phone ?? '').trim()) throw new Error(`Cliente ${index + 1}: el contacto es obligatorio.`)
    if (!['subscriber', 'client'].includes(customer.kind)) throw new Error(`Cliente ${index + 1}: la condición no es válida.`)
    const expectedPrefix = customer.kind === 'subscriber' ? 'PIG-' : 'CLI-'
    if (!String(customer.account || '').toUpperCase().startsWith(expectedPrefix)) throw new Error(`Cliente ${index + 1}: el código debe comenzar con ${expectedPrefix}`)
    if (!text(customer.account, 80) || !text(customer.phone, 50) || !text(customer.address, 320) || !text(customer.street, 220) || !text(customer.locality, 120) || !text(customer.province, 120) || !text(customer.type, 120) || JSON.stringify(customer.fields || {}).length > 20_000) throw new Error(`Cliente ${index + 1}: uno de los datos supera el máximo permitido.`)
  })
  state.history.forEach((record, index) => {
    if (!date(record.date) || !time(record.time) || !time(record.scheduledTime)) throw new Error(`Historial ${index + 1}: fecha u hora inválida.`)
    if (!text(record.client, 200) || !text(record.service, 160) || !text(record.address, 320) || !text(record.phone, 50) || !text(record.detail, 4000)) throw new Error(`Historial ${index + 1}: uno de los campos es demasiado extenso.`)
    if (!['Pendiente', 'Completado', 'Cancelado', 'Reprogramado', 'Requiere revisión'].includes(record.status)) throw new Error(`Historial ${index + 1}: el estado no es válido.`)
    if (!Array.isArray(record.technicianIds || [])) throw new Error(`Historial ${index + 1}: la asignación de técnicos no es válida.`)
    if (record.serviceId && (!Number.isInteger(Number(record.estimatedMinutes)) || Number(record.estimatedMinutes) < 15 || Number(record.estimatedMinutes) > 720)) throw new Error(`Historial ${index + 1}: el tiempo estimado debe estar entre 15 minutos y 12 horas.`)
    if (!internalPlanningIsValid(record)) throw new Error(`Historial ${index + 1}: la nota o el checklist interno contiene datos no válidos.`)
  })
  state.history.forEach((record, index) => {
    if (String(record.customerId || '').trim() && !customerIds.has(String(record.customerId))) throw new Error(`Historial ${index + 1}: el cliente vinculado no existe.`)
    if (record.subscriberReservation && String(record.customerId || '').trim()) throw new Error(`Historial ${index + 1}: una reserva PIG pendiente no puede estar vinculada a un cliente.`)
    if (record.subscriberReservation && ![record.clientNameAtService || record.client, record.address, record.phone].every(value => String(value || '').trim())) throw new Error(`Historial ${index + 1}: la reserva PIG debe incluir nombre, dirección y contacto provisorios.`)
    if (!serviceIds.has(String(record.serviceId))) throw new Error(`Historial ${index + 1}: el tipo de servicio vinculado no existe.`)
    if ((record.technicianIds || []).some(id => !employeeIds.has(String(id)))) throw new Error(`Historial ${index + 1}: contiene un técnico inexistente.`)
  })
  const agendaTeams = [...(state.agenda?.teams || [])]
  Object.entries(state.agenda?.weekly || {}).forEach(([key, value]) => {
    if (key === '_monthlyTeams') Object.values(value || {}).forEach(config => agendaTeams.push(...(config?.teams || [])))
    else if (!key.startsWith('_')) agendaTeams.push(...(value?.teams || []))
  })
  agendaTeams.forEach((team, teamIndex) => {
    if (!String(team.teamId || '').trim()) throw new Error(`Agenda: el equipo ${teamIndex + 1} no tiene ID.`)
    if (!Array.isArray(team.memberIds || []) || !Array.isArray(team.tasks || [])) throw new Error(`Agenda: el equipo ${teamIndex + 1} tiene una estructura inválida.`)
    if ((team.memberIds || []).some(id => !employeeIds.has(String(id)))) throw new Error(`Agenda: el equipo ${teamIndex + 1} contiene un técnico inexistente.`)
    ;(team.tasks || []).forEach((task, taskIndex) => {
      if (!time(task.time) || !text(task.service, 160) || !text(task.client, 200) || !text(task.address, 320) || !text(task.phone, 50) || !text(task.detail, 4000)) throw new Error(`Agenda: servicio ${taskIndex + 1} del equipo ${teamIndex + 1} contiene datos inválidos.`)
      if (task.serviceId && !serviceIds.has(String(task.serviceId))) throw new Error(`Agenda: servicio ${taskIndex + 1} del equipo ${teamIndex + 1} tiene un tipo inexistente.`)
      if (task.customerId && !customerIds.has(String(task.customerId))) throw new Error(`Agenda: servicio ${taskIndex + 1} del equipo ${teamIndex + 1} tiene un cliente inexistente.`)
      if (!internalPlanningIsValid(task)) throw new Error(`Agenda: la nota o el checklist interno del servicio ${taskIndex + 1} del equipo ${teamIndex + 1} contiene datos no válidos.`)
    })
  })
  validateChangedAgendaSchedules(state, previousState)
  if (previousState) assertNoPastWeeklyServiceAdditions(state.agenda, previousState.agenda)
}

const traceActor = user => ({ id: user.id, name: user.name || user.email || 'Usuario', role: user.role || '', at: new Date().toISOString() })
const traceAliases = record => [record?.taskId && `task:${record.taskId}`, record?.sourceTaskId && `task:${record.sourceTaskId}`, record?.historyId && `history:${record.historyId}`, record?.id && `history:${record.id}`].filter(Boolean)
const serviceRecordHasContent = record => Boolean(record && (record.historyId || record.customerId || record.serviceId || ['client', 'service', 'address', 'phone', 'detail'].some(key => String(record[key] || '').trim())))
function stampStateServiceTrace(state, previousAgenda, previousHistory, user) {
  const previous = new Map()
  const traces = new Map()
  const remember = record => traceAliases(record).forEach(alias => { if (!previous.has(alias)) previous.set(alias, record); if (record.createdBy) traces.set(alias, { createdBy: record.createdBy }) })
  const visitAgenda = (agenda, visit) => {
    ;(agenda?.teams || []).forEach(team => (team.tasks || []).forEach(visit))
    Object.entries(agenda?.weekly || {}).forEach(([key, value]) => key === '_monthlyTeams'
      ? Object.values(value || {}).forEach(config => (config?.teams || []).forEach(team => (team.tasks || []).forEach(visit)))
      : !key.startsWith('_') && (value?.teams || []).forEach(team => (team.tasks || []).forEach(visit)))
  }
  visitAgenda(previousAgenda, remember); (previousHistory || []).forEach(remember)
  const actor = traceActor(user)
  const stamp = record => {
    if (!serviceRecordHasContent(record)) { const { createdBy, lastUpdatedBy, ...empty } = record || {}; return empty }
    const aliases = traceAliases(record)
    const old = aliases.map(alias => previous.get(alias)).find(Boolean)
    const known = aliases.map(alias => traces.get(alias)).find(Boolean) || {}
    const createdBy = old?.createdBy || known.createdBy || (!old ? actor : undefined)
    // Se conserva una marca histórica anterior para no reescribir masivamente
    // la base, pero nunca se crea ni actualiza: la única traza vigente es createdBy.
    const { lastUpdatedBy: _discardedUpdate, ...content } = record
    const next = { ...content, ...(createdBy ? { createdBy } : {}), ...(old?.lastUpdatedBy ? { lastUpdatedBy: old.lastUpdatedBy } : {}) }
    aliases.forEach(alias => traces.set(alias, { createdBy }))
    return next
  }
  const stampTeams = teams => (teams || []).map(team => ({ ...team, tasks: (team.tasks || []).map(stamp) }))
  const agenda = state.agenda || {}
  const weekly = Object.fromEntries(Object.entries(agenda.weekly || {}).map(([key, value]) => key === '_monthlyTeams'
    ? [key, Object.fromEntries(Object.entries(value || {}).map(([month, config]) => [month, { ...config, teams: stampTeams(config?.teams) }]))]
    : [key, key.startsWith('_') ? value : { ...value, teams: stampTeams(value?.teams) }]))
  return { ...state, agenda: { ...agenda, teams: stampTeams(agenda.teams), weekly }, history: (state.history || []).map(stamp) }
}

const serviceIsCompleted = record => record?.status === 'Completado' || record?.technicalStatus === 'Completado'
function assertServiceCanBeCompleted(record, now = new Date().toISOString()) {
  const instant = new Date(now)
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(instant).filter(part => part.type !== 'literal').map(part => [part.type, part.value]))
  const today = `${parts.year}-${parts.month}-${parts.day}`
  const serviceDate = String(record?.date || '')
  if (serviceDate > today) { const error = new Error('No se puede completar un servicio antes de su fecha y hora programadas.'); error.statusCode = 409; throw error }
  if (serviceDate !== today) return
  const match = String(record?.time || record?.scheduledTime || '').match(/^(\d{1,2}):(\d{2})$/)
  if (!match) return
  const scheduled = Number(match[1]) * 60 + Number(match[2])
  const current = Number(parts.hour) * 60 + Number(parts.minute)
  if (scheduled > current) { const error = new Error('No se puede completar un servicio antes de su fecha y hora programadas.'); error.statusCode = 409; throw error }
}
function normalizeHistoryCompletionTimes(history = [], previousHistory = [], now = new Date().toISOString()) {
  const previousById = new Map((previousHistory || []).map(record => [String(record.id), record]))
  return (history || []).map(record => {
    const previous = previousById.get(String(record.id))
    const wasCompleted = serviceIsCompleted(previous)
    const isCompleted = serviceIsCompleted(record)
    if (!isCompleted) {
      if (!wasCompleted && !record.completedAt) return record
      const { completedAt: _discardedCompletedAt, ...withoutCompletion } = record
      return withoutCompletion
    }
    if (!previous || !wasCompleted) {
      assertServiceCanBeCompleted(record, now)
      return { ...record, completedAt: now }
    }
    if (previous.completedAt) return { ...record, completedAt: previous.completedAt }
    const { completedAt: _discardedLegacyCompletion, ...legacyRecord } = record
    return legacyRecord
  })
}

function saveState(state, user) {
  const expectedRevision = Number(state.revision)
  const actualRevision = currentStateRevision()
  if (!Number.isInteger(expectedRevision) || expectedRevision !== actualRevision) {
    const error = new Error('Los datos cambiaron en otra sesión. Recargá la página antes de volver a guardar.')
    error.statusCode = 409
    throw error
  }
  const previousState = readState()
  state = authorizedIncomingState(state, user)
  const normalizedRoles = (state.roles || []).map(role => ({ ...role, code: role.code || legacyRoleCode(role) }))
  const roleById = new Map(normalizedRoles.map(role => [String(role.id), role]))
  const roleByName = new Map(normalizedRoles.map(role => [normalizedRoleName(role.name), role]))
  const normalizedEmployees = (state.employees || []).map(employee => {
    const matchedRole = roleById.get(String(employee.roleId ?? '')) || roleByName.get(normalizedRoleName(employee.role))
    return matchedRole ? { ...employee, roleId: matchedRole.id, role: matchedRole.name } : employee
  })
  const employeeById = new Map(normalizedEmployees.map(employee => [String(employee.id), employee]))
  const employeeByName = new Map(normalizedEmployees.map(employee => [normalizedCustomerValue(employee.name), employee]))
  const normalizedServices = ensureVehicleControlService((state.services || []).map(service => ({ ...service, code: service.code || legacyServiceCode(service), category: service.category || (normalizedServiceName(service.name).startsWith('instalacion') ? 'installation' : 'service'), estimatedMinutes: normalizeServiceEstimatedMinutes(service.estimatedMinutes) })))
  const normalizedVehicles = (state.vehicles || []).map(vehicle => ({ ...vehicle, brand: String(vehicle.brand || '').trim(), model: String(vehicle.model || '').trim(), year: Number(vehicle.year), mileage: vehicle.mileage == null || vehicle.mileage === '' ? null : Number(vehicle.mileage), plate: String(vehicle.plate || '').trim().toLocaleUpperCase('es-AR') }))
  const serviceById = new Map(normalizedServices.map(service => [String(service.id), service]))
  const serviceByName = new Map(normalizedServices.map(service => [normalizedServiceName(service.name), service]))
  const previousServiceById = new Map((previousState.services || []).map(service => [String(service.id), service]))
  const previousServiceByName = new Map((previousState.services || []).map(service => [normalizedServiceName(service.name), service]))
  const normalizeServiceReference = item => {
    const matched = serviceById.get(String(item.serviceId ?? '')) || serviceByName.get(normalizedServiceName(item.service))
    if (!matched) return item
    const previousService = previousServiceById.get(String(item.serviceId ?? '')) || previousServiceByName.get(normalizedServiceName(item.service))
    const previousDefault = normalizeServiceEstimatedMinutes(previousService?.estimatedMinutes, matched.estimatedMinutes)
    const closed = ['Completado', 'Cancelado', 'Reprogramado'].includes(item?.status)
    const customized = item.estimatedMinutesCustomized === true || (item.estimatedMinutesCustomized !== false && item.estimatedMinutes != null && Number(item.estimatedMinutes) !== Number(previousDefault))
    const estimatedMinutes = closed || customized ? normalizeServiceEstimatedMinutes(item.estimatedMinutes, matched.estimatedMinutes) : matched.estimatedMinutes
    return { ...item, serviceId: matched.id, service: matched.name, estimatedMinutes, estimatedMinutesCustomized: closed ? (item.estimatedMinutesCustomized ?? true) : customized }
  }
  const completedRetirementCustomerIds = new Set((state.history || [])
    .filter(record => record.status === 'Completado' && normalizedServiceName(record.service).includes('retiro de equipo'))
    .map(record => String(record.customerId || ''))
    .filter(Boolean))
  let nextClientNumber = Math.max(0, ...(state.customers || []).map(customer => Number(String(customer.account || '').match(/^CLI-(\d+)$/i)?.[1]) || 0)) + 1
  const normalizedCustomers = (state.customers || []).map(customer => {
    const kind = customerKind(customer)
    const rawName = String(customer.name || '').replace(/\s+/g, ' ').trim().toLocaleUpperCase('es-AR')
    const rawStreet = String(customer.street || '').trim()
    const rawPhone = String(customer.phone || '').trim()
    const name = rawName || (kind === 'subscriber' ? '-' : '')
    const street = rawStreet || (kind === 'subscriber' ? String(customer.address || '').trim() || '-' : '')
    const address = String(customer.address || '').trim() || (street ? [street, customer.locality, customer.province].filter(Boolean).join(', ') : '')
    const phone = rawPhone || (kind === 'subscriber' ? '-' : '')
    const normalized = { ...customer, customerId: customer.customerId || legacyCustomerId(customer), kind, name, street, address, phone }
    if (normalized.kind !== 'subscriber' || !completedRetirementCustomerIds.has(String(normalized.customerId))) return normalized
    return { ...normalized, kind: 'client', account: `CLI-${String(nextClientNumber++).padStart(4, '0')}`, type: 'Cliente de servicio', convertedFromAccount: normalized.account, subscriptionEndedAt: new Date().toISOString() }
  })
  const customerById = new Map(normalizedCustomers.map(customer => [String(customer.customerId), customer]))
  const customerByAccount = new Map()
  normalizedCustomers.forEach(customer => {
    customerByAccount.set(String(customer.account).trim().toUpperCase(), customer)
    if (customer.convertedFromAccount) customerByAccount.set(String(customer.convertedFromAccount).trim().toUpperCase(), customer)
  })
  const customerByName = new Map()
  normalizedCustomers.forEach(customer => { const key = normalizedCustomerValue(customer.name); customerByName.set(key, customerByName.has(key) ? null : customer) })
  const normalizeCustomerReference = item => {
    const clientText = normalizedCustomerValue(item.client)
    const matched = customerById.get(String(item.customerId || '')) || customerByAccount.get(String(item.clientAccount || item.account || customerCodeFromText(item.client)).trim().toUpperCase()) ||
      normalizedCustomers.find(customer => normalizedCustomerValue(`${customer.account} ${customer.name}`) === clientText) || customerByName.get(clientText)
    return matched ? { ...item, customerId: matched.customerId, clientAccount: matched.account, clientNameAtService: matched.name, client: `${matched.account} ${matched.name}` } : item
  }
  const normalizeReference = item => normalizeCustomerReference(normalizeServiceReference(item))
  const normalizeTeam = (team, index, month) => {
    const byId = (team.memberIds || []).map(id => employeeById.get(String(id))).filter(Boolean)
    const byName = (team.members || []).map(name => employeeByName.get(normalizedCustomerValue(name))).filter(Boolean)
    const members = [...new Map([...byId, ...byName].map(employee => [String(employee.id), employee])).values()]
    return { ...team, teamId: team.teamId || stableTeamId(month || 'current', index), memberIds: members.map(employee => employee.id), members: members.map(employee => employee.name), tasks: (team.tasks || []).map(normalizeReference) }
  }
  const normalizeTeams = (teams, month) => dedupeAgendaTeams((teams || []).map((team, index) => normalizeTeam(team, index, month)))
  const incomingAgenda = state.agenda || {}
  const normalizedWeekly = Object.fromEntries(Object.entries(incomingAgenda.weekly || {}).map(([key, value]) => {
    if (key === '_monthlyTeams') return [key, Object.fromEntries(Object.entries(value || {}).map(([month, config]) => [month, { ...config, teams: normalizeTeams(config?.teams, month) }]))]
    return [key, key.startsWith('_') ? value : { ...value, teams: normalizeTeams(value?.teams, key.slice(0, 7)) }]
  }))
  const normalizeHistoryRecord = record => {
    const base = normalizeReference(record)
    const byId = (base.technicianIds || []).map(id => employeeById.get(String(id))).filter(Boolean)
    const byName = (base.technicians || []).map(name => employeeByName.get(normalizedCustomerValue(name))).filter(Boolean)
    const technicians = [...new Map([...byId, ...byName].map(employee => [String(employee.id), employee])).values()]
    const teamIndex = Number(String(base.team || '').match(/\d+/)?.[0]) - 1
    return { ...base, status: base.status || 'Pendiente', teamId: base.teamId ?? (teamIndex >= 0 ? stableTeamId(String(base.date || '').slice(0, 7), teamIndex) : null), technicianIds: technicians.map(employee => employee.id), technicians: technicians.map(employee => employee.name) }
  }
  const previousHistory = rows('work_history')
  const normalizedIncomingHistory = normalizeHistoryCompletionTimes((state.history || []).map(normalizeHistoryRecord), previousHistory)
  state = { ...state, roles: normalizedRoles, employees: normalizedEmployees, services: normalizedServices, vehicles: normalizedVehicles, customers: normalizedCustomers, history: normalizedIncomingHistory, agenda: { ...incomingAgenda, teams: normalizeTeams(incomingAgenda.teams, String(incomingAgenda.date || '').slice(0, 7)), weekly: normalizedWeekly } }
  const storedAgenda = db.prepare('SELECT data FROM agendas WHERE id = ?').get('current')
  const previousAgenda = storedAgenda ? JSON.parse(storedAgenda.data) : {}
  state = stampStateServiceTrace(state, previousAgenda, previousHistory, user)
  validateState(state, { agenda: previousAgenda })
  const previousEmployees = new Map(rows('employees').map(employee => [String(employee.id), employee]))
  const nextAgenda = state.agenda || {}
  // Evita que un cliente con datos anteriores vuelva a guardar abreviaturas históricas.
  const normalizedHistory = normalizeHistoryTechnicians(state.history || [])
  const securedEmployees = (state.employees || []).map(employee => {
    const previous = previousEmployees.get(String(employee.id))
    const next = { ...employee }
    if (next.password?.trim() && (next.password.trim().length < 8 || !/[a-z]/.test(next.password) || !/[A-Z]/.test(next.password) || !/\d/.test(next.password))) throw new Error('Las contraseñas deben tener al menos 8 caracteres, una mayúscula, una minúscula y un número.')
    if (!previous && !next.password?.trim()) throw new Error('Todo empleado nuevo requiere una contraseña.')
    // En una edición sin nueva contraseña se conserva el hash existente.
    if (next.password?.trim()) next.passwordHash = hashPassword(next.password)
    else if (previous?.passwordHash) next.passwordHash = previous.passwordHash
    // Compatibilidad: la primera autenticación convierte automáticamente credenciales antiguas.
    else if (previous?.password) next.passwordHash = hashPassword(previous.password)
    delete next.password
    return next
  })
  db.exec('BEGIN')
  try {
    // El registro se realiza dentro de la misma transacción que los datos:
    // nunca queda una acción auditada que no haya sido guardada (ni al revés).
    auditChanges('roles', state.roles, 'id', 'Rol', user)
    auditChanges('employees', securedEmployees, 'id', 'Empleado', user)
    auditChanges('services', state.services, 'id', 'Tipo de servicio', user)
    auditChanges(readState().vehicles, state.vehicles, 'id', 'Vehículo', user)
    auditChanges('work_history', normalizedHistory, 'id', 'Servicio / historial', user)
    auditChanges('customers', state.customers, 'customerId', 'Abonado / Cliente', user)
    auditChanges('reviews', state.reviews, 'id', 'Reseña', user)
    if (JSON.stringify(previousAgenda) !== JSON.stringify(nextAgenda)) writeAudit(user, 'Modificó', 'Agenda técnica', 'agenda-actual', previousAgenda, nextAgenda)
    replaceRows('roles', state.roles, 'id')
    replaceRows('employees', securedEmployees, 'id')
    replaceRows('services', state.services, 'id')
    replaceRows('work_history', normalizedHistory, 'id')
    replaceRows('customers', state.customers, 'account')
    if (JSON.stringify(previousState.customers) !== JSON.stringify(state.customers)) db.prepare('DELETE FROM preferences WHERE key = ?').run(CUSTOMER_IMPORT_BACKUP_KEY)
    replaceRows('reviews', state.reviews, 'id')
    db.prepare('INSERT OR REPLACE INTO agendas (id, data) VALUES (?, ?)').run('current', JSON.stringify(nextAgenda))
    db.prepare('INSERT OR REPLACE INTO preferences (key, value) VALUES (?, ?)').run('theme', state.preferences?.theme || 'light')
    db.prepare('INSERT OR REPLACE INTO preferences (key, value) VALUES (?, ?)').run('vehicles', JSON.stringify(state.vehicles || []))
    const nextRevision = actualRevision + 1
    db.prepare('INSERT OR REPLACE INTO preferences (key, value) VALUES (?, ?)').run('state_revision', String(nextRevision))
    db.exec('COMMIT')
    return nextRevision
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

function send(res, status, data) {
  setSecurityHeaders(res)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(data))
}

function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'")
  if (secureCookies) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
}

const STATIC_CONTENT_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
}

function setBrowserSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  res.setHeader('Content-Security-Policy', "default-src 'self'; base-uri 'self'; connect-src 'self'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'")
  if (secureCookies) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
}

function serveApplication(req, res, pathname) {
  if (!['GET', 'HEAD'].includes(req.method) || !fs.existsSync(path.join(publicDir, 'index.html'))) return false

  let requestedPath
  try { requestedPath = decodeURIComponent(pathname) } catch { requestedPath = '/' }
  const relativePath = requestedPath === '/' ? 'index.html' : requestedPath.replace(/^\/+/, '')
  const candidate = path.resolve(publicDir, relativePath)
  const insidePublicDir = candidate === publicDir || candidate.startsWith(`${publicDir}${path.sep}`)
  const hasExtension = Boolean(path.extname(relativePath))
  const filePath = insidePublicDir && fs.existsSync(candidate) && fs.statSync(candidate).isFile()
    ? candidate
    : (!hasExtension ? path.join(publicDir, 'index.html') : null)

  if (!filePath) return false
  setBrowserSecurityHeaders(res)
  const extension = path.extname(filePath).toLowerCase()
  const isEntryPoint = path.basename(filePath) === 'index.html'
  res.setHeader('Content-Type', STATIC_CONTENT_TYPES[extension] || 'application/octet-stream')
  res.setHeader('Cache-Control', isEntryPoint ? 'no-cache' : 'public, max-age=31536000, immutable')
  res.writeHead(200)
  if (req.method === 'HEAD') { res.end(); return true }
  res.end(fs.readFileSync(filePath))
  return true
}

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map(value => value.trim().split('=').map(decodeURIComponent)).filter(([key]) => key))
}

function publicEmployee(employee) {
  const { password, passwordHash, ...safeEmployee } = employee
  return safeEmployee
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex')
  return `${salt}:${hash}`
}

function verifyPassword(password, storedHash) {
  if (!storedHash?.includes(':')) return false
  const [salt, hash] = storedHash.split(':')
  const calculated = crypto.scryptSync(String(password), salt, 64).toString('hex')
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(calculated, 'hex'))
}

function sanitizeEmployeesForRead() {
  return rows('employees').map(publicEmployee)
}

function sessionUser(req) {
  const token = parseCookies(req.headers.cookie).pignus_session
  const session = token && sessions.get(token)
  if (!session || session.expiresAt < Date.now()) {
    if (token) sessions.delete(token)
    return null
  }
  const employee = rows('employees').find(item => String(item.id) === String(session.user.id))
  if (!employee || employee.status !== 'Activo') {
    sessions.delete(token)
    return null
  }
  const role = roleForEmployee(employee)
  if (!role) {
    sessions.delete(token)
    return null
  }
  const user = { id: employee.id, name: employee.name, email: employee.email, roleId: role.id, roleCode: role.code || legacyRoleCode(role), role: role.name, permissions: role.permissions || {} }
  session.user = user
  return user
}

function localSessionContext(req) {
  const token = parseCookies(req.headers.cookie).pignus_session
  const user = sessionUser(req)
  const session = token && sessions.get(token)
  return user && session ? { token, user, session } : null
}

function requireSession(req, res) {
  const user = sessionUser(req)
  if (!user) {
    send(res, 401, { code: 'SESSION_ENDED', error: 'Esta sesión ya no está activa. La cuenta pudo haberse abierto en otro dispositivo o la sesión pudo haber vencido.' })
    return null
  }
  return user
}

function readJson(req, limit = 50_000) {
  return new Promise((resolve, reject) => {
    let body = ''
    let tooLarge = false
    req.on('data', chunk => {
      if (tooLarge) return
      body += chunk
      if (Buffer.byteLength(body, 'utf8') > limit) { tooLarge = true; body = '' }
    })
    req.on('end', () => {
      if (tooLarge) return reject(new Error('Solicitud demasiado grande.'))
      try { resolve(JSON.parse(body || '{}')) } catch { reject(new Error('Datos inválidos.')) }
    })
    req.on('error', reject)
  })
}

function loginLimited(req) {
  const ip = req.socket.remoteAddress || 'local'
  const attempt = loginAttempts.get(ip)
  if (!attempt || attempt.until < Date.now()) return false
  return attempt.count >= LOGIN_MAX_ATTEMPTS
}

function registerLoginFailure(req) {
  const ip = req.socket.remoteAddress || 'local'
  const current = loginAttempts.get(ip)
  const withinWindow = current?.until > Date.now()
  loginAttempts.set(ip, { count: withinWindow ? current.count + 1 : 1, until: Date.now() + LOGIN_WINDOW })
}

function clearLoginFailures(req) { loginAttempts.delete(req.socket.remoteAddress || 'local') }

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]))
}

function reportDate(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  return match ? `${match[3]}/${match[2]}/${match[1]}` : String(value || '')
}

function compareReportRecords(left, right) {
  return String(left.date || '').localeCompare(String(right.date || ''))
    || String(left.time || left.scheduledTime || '').localeCompare(String(right.time || right.scheduledTime || ''))
    || String(left.client || '').localeCompare(String(right.client || ''), 'es', { sensitivity: 'base' })
    || String(left.id || '').localeCompare(String(right.id || ''))
}

function professionalExcelHtml({ title, description, month, headers, rows, widths }) {
  const monthLabel = new Date(`${month}-01T12:00:00`).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })
  const generatedAt = new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date())
  const body = rows.map((row, rowIndex) => `<tr class="${rowIndex % 2 ? 'alternate' : ''}">${row.map((value, columnIndex) => {
    const header = headers[columnIndex]
    const rendered = header === 'Fecha' ? reportDate(value) : value
    const className = header === 'Contacto' ? 'text-value contact' : header === 'Fecha' ? 'date-value' : 'text-value'
    return `<td class="${className}">${escapeHtml(rendered) || '&nbsp;'}</td>`
  }).join('')}</tr>`).join('')
  return `<!DOCTYPE html><html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"><style>
    @page{size:landscape;margin:0.45in}body{font-family:Aptos,Calibri,Arial,sans-serif;color:#173626;background:#fff;margin:0}.report{border-collapse:collapse;width:100%;table-layout:fixed}.brand td{height:26px;padding:8px 12px;background:#123122;color:#d8a016;font-size:12px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase}.title td{padding:16px 12px 4px;background:#123122;color:#fff;font-size:24px;font-weight:700}.description td{padding:2px 12px 16px;background:#123122;color:#d5e2d9;font-size:11px}.meta td{padding:11px 12px;background:#f4ecd3;color:#405748;font-size:11px;border-bottom:2px solid #c99311}.meta b{color:#173626}.spacer td{height:10px}.headers th{padding:10px 9px;background:#c99311;color:#fff;font-size:11px;font-weight:700;text-align:left;border-bottom:2px solid #8d6505}.report tbody td{padding:9px;border-bottom:1px solid #d9e4da;vertical-align:top;font-size:10px;white-space:normal}.report tbody tr.alternate td{background:#f5f8f5}.date-value{white-space:nowrap!important;text-align:center;mso-number-format:"dd/mm/yyyy"}.contact{white-space:nowrap!important;mso-number-format:"\\@"}.footer td{padding:13px 12px;color:#6b7d70;font-size:9px;border-top:2px solid #c99311}.count{font-size:15px;font-weight:700;color:#173626}.confidential{float:right;font-weight:700;color:#6b5220}
  </style></head><body><table class="report"><colgroup>${widths.map(width => `<col style="width:${width}">`).join('')}</colgroup><thead><tr class="brand"><td colspan="${headers.length}">PIGNUS · Gestión operativa</td></tr><tr class="title"><td colspan="${headers.length}">${escapeHtml(title)}</td></tr><tr class="description"><td colspan="${headers.length}">${escapeHtml(description)}</td></tr><tr class="meta"><td colspan="${headers.length}"><b>Período:</b> ${escapeHtml(monthLabel)} &nbsp;&nbsp;·&nbsp;&nbsp; <b>Total de registros:</b> <span class="count">${rows.length}</span> &nbsp;&nbsp;·&nbsp;&nbsp; <b>Generado:</b> ${escapeHtml(generatedAt)}</td></tr><tr class="spacer"><td colspan="${headers.length}"></td></tr><tr class="headers">${headers.map(header => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead><tbody>${body || `<tr><td colspan="${headers.length}">No existen registros para el período seleccionado.</td></tr>`}</tbody><tfoot><tr class="footer"><td colspan="${headers.length}">Agenda técnica PIGNUS <span class="confidential">Documento de uso interno</span></td></tr></tfoot></table></body></html>`
}

function alarmCategory(record) {
  if (record.installationZone) return record.installationZone
  const address = `${record.address || ''} ${record.client || ''}`.toLowerCase()
  if (address.includes('docta')) return 'docta'
  if (address.includes('nobu')) return 'nobu-town'
  return 'residencial'
}

function clearDailyAgenda(user) {
  const stored = db.prepare('SELECT data FROM agendas WHERE id = ?').get('current')
  const previous = stored ? JSON.parse(stored.data) : {}
  const date = new Date().toISOString().slice(0, 10)
  const next = {
    ...previous,
    date,
    teams: [{ teamId: stableTeamId(date.slice(0, 7), 0), memberIds: [], members: [], tasks: [] }]
  }
  const revision = currentStateRevision() + 1
  db.exec('BEGIN')
  try {
    db.prepare('INSERT OR REPLACE INTO agendas (id, data) VALUES (?, ?)').run('current', JSON.stringify(next))
    writeAudit(user, 'Limpió', 'Agenda del día', 'agenda-diaria', previous, next)
    db.prepare('INSERT OR REPLACE INTO preferences (key, value) VALUES (?, ?)').run('state_revision', String(revision))
    db.exec('COMMIT')
    return revision
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

/** Genera el reporte Excel compatible solicitado por gerencia, filtrado por ubicación. */
function exportHistory(res, month, category, technicianId = null, format = 'excel') {
  const isRetirementExport = category === 'retirements'
  // "all" permite obtener un único reporte mensual sin perder los reportes por ubicación.
  const isAllCategories = category === 'all'
  const alarmService = rows('services').find(service => service.code === 'alarm-installation')
  const records = rows('work_history').filter(record => {
    if (!record.date?.startsWith(month) || (technicianId && !record.technicianIds?.some(id => String(id) === String(technicianId)))) return false
    if (isRetirementExport) return record.status === 'Completado' && normalizedServiceName(record.service).includes('retiro de equipo')
    const installationCategory = alarmCategory(record)
    return !record.subscriberReservation && installationCategory !== 'no-monitoreada' && (String(record.serviceId) === String(alarmService?.id) || (!record.serviceId && normalizedServiceName(record.service) === 'instalacion de alarma')) && (isAllCategories || installationCategory === category)
  }).sort(compareReportRecords)
  if (isRetirementExport) {
    const headers = ['Fecha', 'Cliente', 'Servicio', 'Dirección', 'Contacto', 'Técnicos asignados']
    const reportRows = records.map(record => [record.date, record.client, record.service, record.address, record.phone, record.technicians?.join(' / ')])
    if (format === 'pdf') {
      const monthLabel = new Date(`${month}-01T12:00:00`).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })
      const generatedAt = new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date())
      setSecurityHeaders(res)
      res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="bajas-servicio-${month}.pdf"` })
      return writeProfessionalPdf(res, { title: 'Bajas de servicio', description: 'Retiros de equipos de alarma completados durante el período seleccionado.', monthLabel, generatedAt, headers, rows: reportRows.map(row => [reportDate(row[0]), ...row.slice(1)]), widths: [58, 170, 95, 190, 100, 156], fileName: `bajas-servicio-${month}.pdf` })
    }
    const html = professionalExcelHtml({ title: 'Bajas de servicio', description: 'Retiros de equipos de alarma completados durante el período seleccionado.', month, headers, rows: reportRows, widths: ['9%', '22%', '13%', '24%', '13%', '19%'] })
    setSecurityHeaders(res)
    res.writeHead(200, { 'Content-Type': 'application/vnd.ms-excel; charset=utf-8', 'Content-Disposition': `attachment; filename="bajas-servicio-${month}.xls"` })
    return res.end(`\ufeff${html}`)
  }
  const label = { docta: 'Docta Urbanización', 'nobu-town': 'Nobu Town', residencial: 'Residenciales', all: 'Todas las instalaciones de alarma' }[category] || 'Instalaciones de alarma'
  const headers = ['Fecha', 'Cliente', 'Dirección', 'Contacto', 'Técnicos asignados']
  const reportRows = records.map(record => [record.date, record.client, record.address, record.phone, record.technicians?.join(' / ')])
  if (format === 'pdf') {
    const monthLabel = new Date(`${month}-01T12:00:00`).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })
    const generatedAt = new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date())
    setSecurityHeaders(res)
    res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="instalaciones-alarma-${category}-${month}.pdf"` })
    return writeProfessionalPdf(res, { title: `Altas de servicio · ${label}`, description: 'Instalaciones de alarma registradas durante el período seleccionado.', monthLabel, generatedAt, headers, rows: reportRows.map(row => [reportDate(row[0]), ...row.slice(1)]), widths: [60, 175, 235, 110, 189], fileName: `instalaciones-alarma-${category}-${month}.pdf` })
  }
  const html = professionalExcelHtml({ title: `Altas de servicio · ${label}`, description: 'Instalaciones de alarma registradas durante el período seleccionado.', month, headers, rows: reportRows, widths: ['9%', '23%', '31%', '14%', '23%'] })
  setSecurityHeaders(res)
  res.writeHead(200, { 'Content-Type': 'application/vnd.ms-excel; charset=utf-8', 'Content-Disposition': `attachment; filename="instalaciones-alarma-${category}-${month}.xls"` })
  res.end(`\ufeff${html}`)
}

function handleCustomerImport(req, res, user) {
  if (req.method === 'GET') {
    if (user.roleCode !== 'administrator') return send(res, 403, { error: 'Solamente un administrador puede consultar importaciones reversibles.' })
    return send(res, 200, { canUndo: Boolean(db.prepare('SELECT value FROM preferences WHERE key = ?').get(CUSTOMER_IMPORT_BACKUP_KEY)?.value) })
  }
  const undo = req.method === 'DELETE'
  if (undo ? user.roleCode !== 'administrator' : !userCan(user, 'accountsImport')) return send(res, 403, { error: undo ? 'Solamente un administrador puede deshacer una importación.' : 'No tenés permiso para importar abonados.' })
  const execute = body => {
    db.exec('BEGIN IMMEDIATE')
    try {
      const current = readState()
      const currentRevision = currentStateRevision()
      let nextCustomers
      if (undo) {
        const stored = db.prepare('SELECT value FROM preferences WHERE key = ?').get(CUSTOMER_IMPORT_BACKUP_KEY)?.value
        if (!stored) { const error = new Error('No hay una importación pendiente para deshacer.'); error.statusCode = 409; throw error }
        let backup
        try { backup = JSON.parse(stored) } catch { backup = null }
        if (!Array.isArray(backup?.customers)) throw new Error('La copia de seguridad de la importación no es válida.')
        nextCustomers = backup.customers
      } else {
        if (!Number.isInteger(Number(body.revision)) || Number(body.revision) !== currentRevision) { const error = new Error('Los datos cambiaron en otra sesión. Recargá la página antes de importar.'); error.statusCode = 409; throw error }
        if (!Array.isArray(body.customers)) throw new Error('La importación no contiene una lista válida de abonados.')
        nextCustomers = body.customers
        db.prepare('INSERT OR REPLACE INTO preferences (key, value) VALUES (?, ?)').run(CUSTOMER_IMPORT_BACKUP_KEY, JSON.stringify({ customers: current.customers, importedAt: new Date().toISOString(), importedBy: { id: user.id, name: user.name, email: user.email } }))
      }
      validateState({ ...current, customers: nextCustomers }, current)
      replaceRows('customers', nextCustomers, 'account')
      if (undo) db.prepare('DELETE FROM preferences WHERE key = ?').run(CUSTOMER_IMPORT_BACKUP_KEY)
      writeAudit(user, undo ? 'Deshizo importación' : 'Importó', 'Abonados / Clientes', 'importacion-maestra', { total: current.customers.length }, { total: nextCustomers.length })
      const revision = currentRevision + 1
      db.prepare('INSERT OR REPLACE INTO preferences (key, value) VALUES (?, ?)').run('state_revision', String(revision))
      db.exec('COMMIT')
      return send(res, 200, { revision, customers: nextCustomers, canUndo: !undo })
    } catch (error) {
      db.exec('ROLLBACK')
      return send(res, error.statusCode || 400, { error: error.message || 'No se pudo procesar la importación.' })
    }
  }
  if (undo) return execute({})
  return readJson(req, 15_000_000).then(execute).catch(error => send(res, 400, { error: error.message || 'No se pudo procesar la importación.' }))
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${host}:${port}`)
  if (req.method === 'GET' && url.pathname === '/api/auth/session') {
    const user = sessionUser(req)
    const hadSessionCookie = Boolean(parseCookies(req.headers.cookie).pignus_session)
    return user
      ? send(res, 200, { user, state: readStateForUser(user) })
      : send(res, 401, hadSessionCookie
        ? { code: 'SESSION_ENDED', error: 'Esta sesión ya no está activa. La cuenta pudo haberse abierto en otro dispositivo o la sesión pudo haber vencido.' }
        : { code: 'SESSION_REQUIRED', error: 'Sin sesión activa.' })
  }
  if (req.method === 'POST' && url.pathname === '/api/auth/login') {
    if (loginLimited(req)) return send(res, 429, { error: 'Demasiados intentos. Esperá 15 minutos antes de volver a intentar.' })
    return readJson(req).then(({ email, password }) => {
      const employee = rows('employees').find(item => item.email?.trim().toLowerCase() === String(email || '').trim().toLowerCase())
      if (!employee) {
        registerLoginFailure(req)
        return send(res, 404, { error: 'El correo ingresado no está dado de alta en el sistema. Ponete en contacto con un Administrador.' })
      }
      const legacyPassword = Buffer.from(String(employee?.password || ''))
      const suppliedPassword = Buffer.from(String(password || ''))
      const validLegacyPassword = legacyPassword.length === suppliedPassword.length && crypto.timingSafeEqual(suppliedPassword, legacyPassword)
      const valid = employee.status === 'Activo' && (employee.passwordHash ? verifyPassword(password, employee.passwordHash) : validLegacyPassword)
      if (!valid) {
        registerLoginFailure(req)
        return send(res, 401, { error: 'Usuario o contraseña incorrectos.' })
      }
      // Migra contraseñas creadas antes de esta mejora sin conservar texto plano.
      if (!employee.passwordHash) {
        employee.passwordHash = hashPassword(employee.password)
        delete employee.password
        db.prepare('UPDATE employees SET data = ? WHERE id = ?').run(JSON.stringify(employee), String(employee.id))
      }
      clearLoginFailures(req)
      const assignedRole = rows('roles').find(role => String(role.id) === String(employee.roleId)) || rows('roles').find(role => normalizedRoleName(role.name) === normalizedRoleName(employee.role))
      const user = { id: employee.id, name: employee.name, email: employee.email, roleId: assignedRole?.id, roleCode: assignedRole?.code || legacyRoleCode(assignedRole || { id: employee.roleId, name: employee.role }), role: assignedRole?.name || employee.role }
      const token = crypto.randomBytes(32).toString('hex')
      let replacedSessions = 0
      for (const [activeToken, session] of sessions) {
        if (String(session.user.id) !== String(user.id)) continue
        sessions.delete(activeToken)
        replacedSessions += 1
      }
      sessions.set(token, { user, expiresAt: Date.now() + SESSION_IDLE_TIMEOUT_MS })
      // Un bloqueo momentáneo del registro de auditoría no debe impedir que una
      // credencial válida abra sesión. El acceso sigue quedando aislado en memoria.
      try {
        writeAudit(user, 'Inició sesión', 'Sesión', String(user.id), null, { sessionExpiresAt: new Date(Date.now() + SESSION_IDLE_TIMEOUT_MS).toISOString(), replacedSessions })
      } catch (auditError) {
        console.error('No se pudo registrar la auditoría del inicio de sesión:', auditError)
      }
      res.setHeader('Set-Cookie', `pignus_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_IDLE_TIMEOUT_MS / 1000}${secureCookies ? '; Secure' : ''}`)
      return send(res, 200, { user, state: readStateForUser(user) })
    }).catch(error => {
      console.error('Error al procesar el acceso:', error)
      const clientError = ['Datos inválidos.', 'Solicitud demasiado grande.'].includes(error?.message)
      send(res, clientError ? 400 : 500, { error: clientError ? error.message : 'No se pudo completar el ingreso. Reiniciá Agenda técnica e intentá nuevamente.' })
    })
  }
  if (req.method === 'POST' && url.pathname === '/api/auth/password-reset-requests') {
    return readJson(req).then(({ email }) => {
      const normalizedEmail = String(email || '').trim().toLowerCase()
      if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) return send(res, 400, { error: 'Ingresá un correo electrónico válido.' })
      const employee = rows('employees').find(item => item.email?.trim().toLowerCase() === normalizedEmail)
      if (!employee) return send(res, 404, { error: 'El correo ingresado no está dado de alta en el sistema. Ponete en contacto con un Administrador.' })
      const requests = passwordResetRequests()
      const existing = requests.find(item => item.email === normalizedEmail)
      const request = { id: existing?.id || crypto.randomUUID(), employeeId: String(employee.id), email: normalizedEmail, requestedAt: new Date().toISOString() }
      savePasswordResetRequests([request, ...requests.filter(item => item.email !== normalizedEmail)])
      return send(res, 200, { ok: true, message: 'La solicitud fue enviada al Administrador.' })
    }).catch(error => send(res, 400, { error: error.message || 'No se pudo registrar la solicitud.' }))
  }
  if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
    return readJson(req).then(({ discardDailyAgenda }) => {
      const token = parseCookies(req.headers.cookie).pignus_session
      const session = token && sessions.get(token)
      const revision = session && discardDailyAgenda && userCan(session.user, 'agenda') ? clearDailyAgenda(session.user) : null
      if (session) writeAudit(session.user, 'Cerró sesión', 'Sesión', String(session.user.id), { sessionExpiresAt: new Date(session.expiresAt).toISOString() }, null)
      if (token) sessions.delete(token)
      res.setHeader('Set-Cookie', 'pignus_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0')
      return send(res, 200, { ok: true, ...(revision == null ? {} : { revision }) })
    }).catch(error => send(res, 400, { error: error.message || 'No se pudo cerrar la sesión.' }))
  }
  if (req.method === 'GET' && url.pathname === '/api/auth/session-status') {
    const context = localSessionContext(req)
    if (!context) return send(res, 401, { code: 'SESSION_ENDED', error: 'Esta sesión ya no está activa. La cuenta pudo haberse abierto en otro dispositivo o la sesión pudo haber vencido.' })
    return send(res, 200, { active: true, expiresAt: new Date(context.session.expiresAt).toISOString() })
  }
  if (req.method === 'POST' && url.pathname === '/api/auth/activity') {
    const context = localSessionContext(req)
    if (!context) return send(res, 401, { code: 'SESSION_ENDED', error: 'Esta sesión ya no está activa. La cuenta pudo haberse abierto en otro dispositivo o la sesión pudo haber vencido.' })
    context.session.expiresAt = Date.now() + SESSION_IDLE_TIMEOUT_MS
    res.setHeader('Set-Cookie', `pignus_session=${context.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_IDLE_TIMEOUT_MS / 1000}${secureCookies ? '; Secure' : ''}`)
    return send(res, 200, { active: true, expiresAt: new Date(context.session.expiresAt).toISOString() })
  }
  if (url.pathname === '/api/auth/password-reset-requests' && ['GET', 'DELETE'].includes(req.method)) {
    const user = requireSession(req, res)
    if (!user) return
    if (user.roleCode !== 'administrator') return send(res, 403, { error: 'Las solicitudes de contraseña son exclusivas del rol Administrador.' })
    if (req.method === 'GET') return send(res, 200, { requests: passwordResetRequests().sort((a, b) => String(b.requestedAt).localeCompare(String(a.requestedAt))) })
    return readJson(req).then(({ id }) => {
      const requests = passwordResetRequests()
      const resolved = requests.find(item => item.id === String(id || ''))
      if (!resolved) return send(res, 404, { error: 'La solicitud ya no está pendiente.' })
      savePasswordResetRequests(requests.filter(item => item.id !== resolved.id))
      writeAudit(user, 'Resolvió', 'Solicitud de contraseña', resolved.id, resolved, null)
      return send(res, 200, { ok: true })
    }).catch(error => send(res, 400, { error: error.message || 'No se pudo resolver la solicitud.' }))
  }
  if (req.method === 'GET' && url.pathname === '/api/history/export') {
    const user = requireSession(req, res)
    if (!user) return
    if (user.roleCode === 'technician') return exportHistory(res, url.searchParams.get('month') || new Date().toISOString().slice(0, 7), url.searchParams.get('category') || 'residencial', user.id, url.searchParams.get('format') || 'excel')
    if (!userCan(user, 'history')) return send(res, 403, { error: 'No tenés permiso para exportar el historial.' })
    return exportHistory(res, url.searchParams.get('month') || new Date().toISOString().slice(0, 7), url.searchParams.get('category') || 'residencial', null, url.searchParams.get('format') || 'excel')
  }
  if (req.method === 'GET' && req.url === '/api/state') {
    const user = requireSession(req, res)
    if (!user) return
    return send(res, 200, readStateForUser(user))
  }
  if (['GET', 'POST', 'DELETE'].includes(req.method) && url.pathname === '/api/customers/import') {
    const user = requireSession(req, res)
    if (!user) return
    return handleCustomerImport(req, res, user)
  }
  if (req.method === 'GET' && url.pathname === '/api/holidays') {
    const user = requireSession(req, res)
    if (!user) return
    const year = validHolidayYear(url.searchParams.get('year'))
    if (!year) return send(res, 400, { error: 'El año solicitado no es válido.' })
    return fetchNationalHolidays(year)
      .then(holidays => send(res, 200, { year, holidays }))
      .catch(error => send(res, 503, { error: error.message }))
  }
  if (req.method === 'GET' && url.pathname === '/api/audit') {
    const user = requireSession(req, res)
    if (!user) return
    if (user.roleCode !== 'administrator') return send(res, 403, { error: 'La auditoría es exclusiva del rol Administrador.' })
    const requestedLimit = Number(url.searchParams.get('limit')) || AUDIT_LOG_LIMIT
    const limit = Math.min(Math.max(requestedLimit, 1), AUDIT_LOG_LIMIT)
    return send(res, 200, { records: recentAuditRows(limit) })
  }
  if (req.method === 'GET' && url.pathname.startsWith('/api/audit/')) {
    const user = requireSession(req, res)
    if (!user) return
    if (user.roleCode !== 'administrator') return send(res, 403, { error: 'La auditoría es exclusiva del rol Administrador.' })
    const record = auditRow(decodeURIComponent(url.pathname.slice('/api/audit/'.length)))
    return record ? send(res, 200, { record }) : send(res, 404, { error: 'El registro de auditoría no existe.' })
  }
  if (req.method === 'GET' && url.pathname.startsWith('/api/vehicle-control/photo/')) {
    const user = requireSession(req, res)
    if (!user) return
    const recordId = decodeURIComponent(url.pathname.slice('/api/vehicle-control/photo/'.length))
    const photo = db.prepare('SELECT mime_type, photo_data FROM vehicle_control_photos WHERE record_id = ?').get(recordId)
    const record = rows('work_history').find(item => String(item.id) === String(recordId))
    if (!photo || !record) return send(res, 404, { error: 'La foto no existe.' })
    const allowed = user.roleCode === 'administrator' || userCan(user, 'history') || record.technicianIds?.some(id => String(id) === String(user.id))
    if (!allowed) return send(res, 403, { error: 'No tenés permiso para ver esta foto.' })
    res.writeHead(200, { 'Content-Type': photo.mime_type, 'Content-Length': photo.photo_data.length, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' })
    return res.end(photo.photo_data)
  }
  if (['GET', 'POST'].includes(req.method) && url.pathname.startsWith('/api/vehicle-insurance/')) {
    const user = requireSession(req, res)
    if (!user) return
    const vehicleId = decodeURIComponent(url.pathname.slice('/api/vehicle-insurance/'.length))
    if (req.method === 'GET') {
      if (!(readState().vehicles || []).some(vehicle => String(vehicle.id) === String(vehicleId))) return send(res, 404, { error: 'El vehículo no existe.' })
      if (user.roleCode !== 'technician' && !userCan(user, 'vehicles')) return send(res, 403, { error: 'No tenés permiso para descargar este seguro.' })
      const document = db.prepare('SELECT file_name, pdf_data FROM vehicle_insurance_documents WHERE vehicle_id = ?').get(vehicleId)
      if (!document) return send(res, 404, { error: 'El seguro no está cargado.' })
      res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${String(document.file_name || 'seguro.pdf').replace(/["\r\n]/g, '')}"`, 'Content-Length': document.pdf_data.length, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' })
      return res.end(document.pdf_data)
    }
    if (user.roleCode !== 'administrator') return send(res, 403, { error: 'Solamente un administrador puede cargar seguros.' })
    return readJson(req, 11_000_000).then(({ fileName, pdf, vehicle: incomingVehicle, insuranceExpiresOn, revision: incomingRevision }) => {
      const match = String(pdf || '').match(/^data:application\/pdf;base64,([a-z0-9+/=]+)$/i)
      const data = match ? Buffer.from(match[1], 'base64') : null
      if (!data?.length || data.length > 3_000_000 || data.subarray(0, 5).toString() !== '%PDF-') return send(res, 400, { error: 'Seleccioná un PDF válido de hasta 3 MB.' })
      const safeName = String(fileName || 'seguro.pdf').trim().slice(0, 180)
      const uploadedAt = new Date().toISOString()
      db.exec('BEGIN IMMEDIATE')
      try {
        const current = readState()
        const currentRevision = currentStateRevision()
        if (incomingRevision != null && Number(incomingRevision) !== currentRevision) {
          const error = new Error('Los datos cambiaron en otra sesión. Recargá la página antes de volver a cargar el seguro.')
          error.statusCode = 409
          throw error
        }
        const previousVehicle = current.vehicles.find(vehicle => String(vehicle.id) === String(vehicleId))
        const submittedVehicle = incomingVehicle && typeof incomingVehicle === 'object' ? incomingVehicle : previousVehicle
        if (!submittedVehicle || String(submittedVehicle.id) !== String(vehicleId)) {
          const error = new Error('El vehículo no existe o sus datos no coinciden.')
          error.statusCode = 404
          throw error
        }
        const expiresOn = String(insuranceExpiresOn || submittedVehicle.insuranceExpiresOn || '')
        if (!/^\d{4}-\d{2}-\d{2}$/.test(expiresOn)) throw new Error('Indicá una fecha de vencimiento válida para el seguro.')
        const documentUrl = `/api/vehicle-insurance/${encodeURIComponent(vehicleId)}`
        const nextVehicle = { ...submittedVehicle, id: vehicleId, insuranceExpiresOn: expiresOn, insuranceFileName: safeName, insuranceUploadedAt: uploadedAt, insuranceDocumentUrl: documentUrl }
        const nextVehicles = previousVehicle
          ? current.vehicles.map(vehicle => String(vehicle.id) === String(vehicleId) ? nextVehicle : vehicle)
          : [...current.vehicles, nextVehicle]
        validateState({ ...current, vehicles: nextVehicles }, current)
        db.prepare('INSERT OR REPLACE INTO vehicle_insurance_documents (vehicle_id, file_name, pdf_data, uploaded_at) VALUES (?, ?, ?, ?)').run(vehicleId, safeName, data, uploadedAt)
        db.prepare('INSERT OR REPLACE INTO preferences (key, value) VALUES (?, ?)').run('vehicles', JSON.stringify(nextVehicles))
        writeAudit(user, 'Cargó seguro', 'Vehículo', vehicleId, previousVehicle || null, nextVehicle)
        const revision = currentRevision + 1
        db.prepare('INSERT OR REPLACE INTO preferences (key, value) VALUES (?, ?)').run('state_revision', String(revision))
        db.exec('COMMIT')
        return send(res, 200, { vehicle: nextVehicle, revision, fileName: safeName, uploadedAt, documentUrl })
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    }).catch(error => send(res, error.statusCode || 400, { error: error.message || 'No se pudo cargar el seguro.' }))
  }
  if (req.method === 'POST' && ['/api/technician/advance-request', '/api/admin/advance-request/approve', '/api/admin/advance-request/deny'].includes(url.pathname)) {
    const user = requireSession(req, res)
    if (!user) return
    const decision = url.pathname.endsWith('/approve') ? 'approved' : url.pathname.endsWith('/deny') ? 'denied' : ''
    if (decision && user.roleCode !== 'administrator') return send(res, 403, { error: 'Esta decisión es exclusiva del rol Administrador.' })
    if (!decision && user.roleCode !== 'technician') return send(res, 403, { error: 'Esta solicitud es exclusiva del rol técnico.' })
    return readJson(req).then(({ recordId }) => {
      db.exec('BEGIN IMMEDIATE')
      try {
        const previousRow = db.prepare('SELECT data FROM work_history WHERE id = ?').get(String(recordId || ''))
        const previous = previousRow?.data ? JSON.parse(previousRow.data) : null
        const next = decision ? resolveServiceAdvance(previous, user, decision) : requestServiceAdvance(previous, user)
        if (next === previous) {
          db.exec('COMMIT')
          return send(res, 200, { record: technicianSafeRecord(previous), revision: currentStateRevision() })
        }
        db.prepare('UPDATE work_history SET data = ? WHERE id = ?').run(JSON.stringify(next), String(next.id))
        const agendaRow = db.prepare('SELECT data FROM agendas WHERE id = ?').get('current')
        if (agendaRow?.data) {
          const nextAgenda = synchronizeAgendaAdvance(JSON.parse(agendaRow.data), next)
          db.prepare('UPDATE agendas SET data = ? WHERE id = ?').run(JSON.stringify(nextAgenda), 'current')
        }
        const action = decision ? (decision === 'approved' ? 'Aprobó adelanto de servicio' : 'Denegó adelanto de servicio') : 'Solicitó adelanto de servicio'
        writeAudit(user, action, 'Servicio / historial', String(next.id), previous, next)
        const revision = currentStateRevision() + 1
        db.prepare('INSERT OR REPLACE INTO preferences (key, value) VALUES (?, ?)').run('state_revision', String(revision))
        db.exec('COMMIT')
        return send(res, 200, { record: user.roleCode === 'technician' ? technicianSafeRecord(next) : next, revision })
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    }).catch(error => send(res, error.statusCode || 400, { error: error.message || 'No se pudo procesar la solicitud de adelanto.' }))
  }
  if (req.method === 'POST' && url.pathname === '/api/technician/status') {
    const user = requireSession(req, res)
    if (!user) return
    if (user.roleCode !== 'technician') return send(res, 403, { error: 'Esta acción es exclusiva del rol técnico.' })
    return readJson(req, 1_600_000).then(({ recordId, type, observation, vehicleMileage, vehiclePhoto }) => {
      const record = rows('work_history').find(item => item.id === recordId)
      const allowed = ['Completado', 'Cancelado', 'Reprogramación solicitada']
      if (!record) return send(res, 404, { error: 'El servicio no existe.' })
      const assigned = record.technicianIds?.some(id => String(id) === String(user.id))
      if (!assigned) return send(res, 403, { error: 'El servicio no está asignado al técnico autenticado.' })
        if (!allowed.includes(type)) return send(res, 400, { error: 'No se puede actualizar este servicio.' })
        if (record.vehicleControl && type !== 'Completado') return send(res, 400, { error: 'El control vehicular debe completarse con foto y kilometraje; no admite cancelación ni reprogramación.' })
        const technicianDayRecords = record.vehicleControl
          ? rows('work_history').filter(item => String(item.date || '') === String(record.date || '') && item.technicianIds?.some(id => String(id) === String(user.id)))
          : []
        if (record.vehicleControl && !vehicleControlIsOpen(record, Date.now(), technicianDayRecords)) return send(res, 409, { error: `El control vehicular se habilita el ${vehicleControlWindowLabel(record)}.` })
        if (record.technicalStatus) {
          if (record.technicalStatus === type && String(record.technicalReportedById) === String(user.id)) return send(res, 200, { record: technicianSafeRecord(record) })
          return send(res, 409, { error: 'Este servicio ya fue informado desde otra sesión.' })
        }
      const completingVehicleControl = Boolean(record.vehicleControl && type === 'Completado')
      let vehicleChange = null
      if (completingVehicleControl) {
        const mileage = Number(vehicleMileage)
        const photoMatch = String(vehiclePhoto || '').match(/^data:(image\/(?:jpeg|png|webp));base64,([a-z0-9+/=]+)$/i)
        const photoBuffer = photoMatch ? Buffer.from(photoMatch[2], 'base64') : null
        if (!Number.isInteger(mileage) || mileage < 1 || mileage > 99999999) return send(res, 400, { error: 'Ingresá un kilometraje válido.' })
        if (!photoBuffer?.length || photoBuffer.length > 1_000_000) return send(res, 400, { error: 'Cargá una foto válida del interior del vehículo.' })
        const stored = db.prepare('SELECT value FROM preferences WHERE key = ?').get('vehicles')
        let vehicles
        try { vehicles = JSON.parse(stored?.value || '[]') } catch { vehicles = [] }
        const vehicleIndex = vehicles.findIndex(vehicle => String(vehicle.id) === String(record.vehicleId))
        if (vehicleIndex < 0) return send(res, 409, { error: 'El vehículo asignado ya no existe.' })
        const previousVehicle = vehicles[vehicleIndex]
        const currentMileage = Number(previousVehicle.mileage || 0)
        if (mileage <= currentMileage) return send(res, 409, { error: `El kilometraje debe ser superior a ${currentMileage.toLocaleString('es-AR')} km.` })
        const nextVehicle = { ...previousVehicle, mileage, mileageUpdatedAt: new Date().toISOString(), mileageUpdatedById: user.id, mileageUpdatedByName: user.name || user.email || 'Técnico' }
        vehicles[vehicleIndex] = nextVehicle
        vehicleChange = { vehicles, before: previousVehicle, after: nextVehicle, mileage, mimeType: photoMatch[1].toLowerCase(), photoBuffer }
      } else if (!String(observation || '').trim()) return send(res, 400, { error: 'La observación es obligatoria para informar el servicio.' })
      if (type === 'Completado' && !record.vehicleControl) assertServiceCanBeCompleted(record)
      const now = new Date().toISOString()
      const updated = { ...record, technicalStatus: type, technicalObservation: String(observation || '').trim() || (completingVehicleControl ? 'Control semanal del vehículo informado.' : ''), technicalReportedAt: now, technicalReportedById: user.id, technicalReportedByName: user.name || user.email || 'Técnico', completedAt: type === 'Completado' ? now : record.completedAt, status: type === 'Completado' ? 'Completado' : 'Requiere revisión', technicianRequest: type === 'Completado' ? '' : type, ...(vehicleChange ? { vehicleMileage: vehicleChange.mileage, vehiclePhotoUrl: `/api/vehicle-control/photo/${encodeURIComponent(String(record.id))}`, vehicleControlReportedAt: now } : {}) }
      db.exec('BEGIN')
      try {
        db.prepare('UPDATE work_history SET data = ? WHERE id = ?').run(JSON.stringify(updated), String(record.id))
        if (vehicleChange) {
          db.prepare('INSERT OR REPLACE INTO preferences (key, value) VALUES (?, ?)').run('vehicles', JSON.stringify(vehicleChange.vehicles))
          db.prepare('INSERT OR REPLACE INTO vehicle_control_photos (record_id, vehicle_id, mime_type, photo_data, created_at) VALUES (?, ?, ?, ?, ?)').run(String(record.id), String(record.vehicleId), vehicleChange.mimeType, vehicleChange.photoBuffer, now)
        }
        const convertedCustomer = convertCompletedRetirementSubscriber(updated)
        writeAudit(user, 'Informó estado técnico', 'Servicio / historial', String(record.id), record, updated)
        if (vehicleChange) writeAudit(user, 'Actualizó kilometraje por control semanal', 'Vehículo', String(record.vehicleId), vehicleChange.before, vehicleChange.after)
        if (convertedCustomer) writeAudit(user, 'Convirtió abonado en cliente por baja', 'Abonado / Cliente', String(convertedCustomer.customerId), { account: convertedCustomer.convertedFromAccount, kind: 'subscriber' }, convertedCustomer)
        db.prepare('INSERT OR REPLACE INTO preferences (key, value) VALUES (?, ?)').run('state_revision', String(currentStateRevision() + 1))
        db.exec('COMMIT')
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
      return send(res, 200, { record: technicianSafeRecord(updated) })
    }).catch(() => send(res, 400, { error: 'No se pudo informar el estado.' }))
  }
  if (req.method === 'POST' && url.pathname === '/api/agenda/daily/clear') {
    const user = requireSession(req, res)
    if (!user) return
    if (!userCan(user, 'agenda')) return send(res, 403, { error: 'No tenés permiso para limpiar la agenda del día.' })
    try { return send(res, 200, { ok: true, revision: clearDailyAgenda(user) }) }
    catch (error) { console.error(error); return send(res, 500, { error: 'No se pudo limpiar la agenda del día.' }) }
  }
  if (req.method === 'PUT' && req.url === '/api/state') {
    const user = requireSession(req, res)
    if (!user) return
    if (user.roleCode === 'technician') return send(res, 403, { error: 'El rol técnico no puede modificar la agenda.' })
    readJson(req, 15_000_000).then(state => {
      const revision = saveState(state, user)
      send(res, 200, { ok: true, revision })
    }).catch(error => { console.error(error); send(res, error?.statusCode || 400, { error: error?.message || 'No se pudieron guardar los datos.' }) })
    return
  }
  if (!url.pathname.startsWith('/api/') && serveApplication(req, res, url.pathname)) return
  send(res, 404, { error: 'Ruta no encontrada.' })
})

server.listen(port, host, () => console.log(`Base de datos disponible en http://${host}:${port}`))

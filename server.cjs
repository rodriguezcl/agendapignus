const http = require('node:http')
const path = require('node:path')
const fs = require('node:fs')
const crypto = require('node:crypto')
const { DatabaseSync } = require('node:sqlite')

// API local: Vite reenvía las rutas /api a este proceso durante el desarrollo.
const port = Number(process.env.PIGNUS_PORT || 3001)
const host = process.env.PIGNUS_HOST || '127.0.0.1'
const dataDir = process.env.PIGNUS_DATA_DIR ? path.resolve(process.env.PIGNUS_DATA_DIR) : path.join(__dirname, 'data')
fs.mkdirSync(dataDir, { recursive: true })
const db = new DatabaseSync(path.join(dataDir, 'agenda-tecnica.db'))

// Las sesiones viven sólo en memoria: al cerrar el servidor se invalidan todas.
// La cookie contiene un identificador aleatorio, nunca la contraseña ni datos del usuario.
const sessions = new Map()
const loginAttempts = new Map()
const SESSION_MAX_AGE = 8 * 60 * 60 * 1000
const LOGIN_WINDOW = 15 * 60 * 1000
const LOGIN_MAX_ATTEMPTS = 5

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

function migrateServiceReferences() {
  const services = rows('services')
  const updateService = db.prepare('UPDATE services SET data = ? WHERE id = ?')
  const normalizedServices = services.map(service => {
    const next = { ...service, code: service.code || legacyServiceCode(service), category: service.category || (normalizedServiceName(service.name).startsWith('instalacion') ? 'installation' : 'service') }
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
    return matched ? { ...item, serviceId: matched.id, service: matched.name } : item
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
    const byAccount = new Map(normalizedCustomers.map(customer => [String(customer.account).trim().toUpperCase(), customer]))
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
    return matched ? { ...item, customerId: matched.customerId, clientAccount: matched.account, ...(reassigned || legacySpacedCode ? { client: `${matched.account} - ${matched.name}`, clientNameAtService: matched.name } : {}) } : item
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

function auditSafe(record) {
  if (!record) return null
  const { password, passwordHash, ...safe } = record
  return safe
}

function writeAudit(user, action, entity, entityId, before, after) {
  const entry = { id: crypto.randomUUID(), at: new Date().toISOString(), user: { id: user.id, name: user.name, email: user.email, role: user.role }, action, entity, entityId, before: auditSafe(before), after: auditSafe(after) }
  db.prepare('INSERT INTO audit_log (id, data) VALUES (?, ?)').run(entry.id, JSON.stringify(entry))
}

function auditChanges(table, records, key, entity, user) {
  const previous = new Map(rows(table).map(record => [String(record[key]), record]))
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
  return {
    revision: currentStateRevision(),
    roles: rows('roles'),
    // Nunca se exponen hashes ni contraseñas a la interfaz.
    employees: sanitizeEmployeesForRead(),
    services: rows('services'),
    history: rows('work_history'),
    customers: rows('customers'),
    reviews: rows('reviews'),
    agenda: agenda ? JSON.parse(agenda.data) : null,
    preferences: theme ? { theme: theme.value } : {}
  }
}

function readTechnicianState(user) {
  return {
    revision: currentStateRevision(),
    roles: [], employees: [], services: [], customers: [], agenda: null, preferences: {},
    // El nombre es solamente una etiqueta visible. El acceso se decide siempre
    // mediante el identificador inmutable del empleado autenticado.
    history: rows('work_history').filter(record => record.technicianIds?.some(id => String(id) === String(user.id)))
  }
}

function readStateForUser(user) {
  if (user.roleCode === 'technician') return readTechnicianState(user)
  const state = readState()
  if (user.roleCode === 'administrator') return state
  const canPlan = userCan(user, 'agenda') || userCan(user, 'weekly')
  return {
    ...state,
    employees: userCan(user, 'employees') ? state.employees : state.employees.map(({ id, firstName, lastName, name, roleId, role, status }) => ({ id, firstName, lastName, name, roleId, role, status })),
    services: userCan(user, 'services') || canPlan || userCan(user, 'history') ? state.services : [],
    customers: userCan(user, 'accounts') || canPlan || userCan(user, 'history') ? state.customers : [],
    history: userCan(user, 'history') ? state.history : [],
    reviews: userCan(user, 'reviews') ? state.reviews : [],
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
  return user?.roleCode === 'administrator' || Boolean(user?.permissions?.[permission])
}

// La interfaz conserva un estado amplio, pero el servidor nunca acepta cambios
// sobre colecciones para las que el rol autenticado no tiene permiso.
function authorizedIncomingState(state, user) {
  const current = readState()
  const administrator = user?.roleCode === 'administrator'
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
  const agenda = {
    ...currentAgenda,
    ...(userCan(user, 'agenda') ? { date: incomingAgenda.date, teams: incomingAgenda.teams } : {}),
    ...(userCan(user, 'weekly') ? { weekly: incomingAgenda.weekly } : {})
  }
  return {
    ...state,
    roles: administrator ? state.roles : current.roles,
    employees,
    services: userCan(user, 'services') ? state.services : current.services,
    history: userCan(user, 'history') ? state.history : current.history,
    customers: userCan(user, 'accounts') ? state.customers : current.customers,
    reviews: userCan(user, 'reviews') ? state.reviews : current.reviews,
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
function validateState(state) {
  if (!state || typeof state !== 'object') throw new Error('El estado recibido no es válido.')

  const collections = ['roles', 'employees', 'services', 'customers', 'history', 'reviews']
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
  ensureUnique(state.customers, 'customerId', 'Cliente')
  ensureUnique(state.customers, 'account', 'Cliente')
  ensureUnique(state.history, 'id', 'Registro de historial')
  ensureUnique(state.reviews, 'id', 'Reseña')

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
    if (!['Activo', 'Inactivo'].includes(service.status)) throw new Error(`Tipo de servicio ${index + 1}: el estado no es válido.`)
  })
  state.customers.forEach((customer, index) => {
    if (!String(customer.name ?? '').trim() || !text(customer.name, 180)) throw new Error(`Cliente ${index + 1}: el titular es obligatorio.`)
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
  })
  state.history.forEach((record, index) => {
    if (!customerIds.has(String(record.customerId))) throw new Error(`Historial ${index + 1}: el cliente vinculado no existe.`)
    if (!serviceIds.has(String(record.serviceId))) throw new Error(`Historial ${index + 1}: el tipo de servicio vinculado no existe.`)
    if ((record.technicianIds || []).some(id => !employeeIds.has(String(id)))) throw new Error(`Historial ${index + 1}: contiene un técnico inexistente.`)
  })
  state.reviews.forEach((review, index) => {
    if (review.customerId && !customerIds.has(String(review.customerId))) throw new Error(`Reseña ${index + 1}: el cliente vinculado no existe.`)
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
    })
  })
  state.reviews.forEach((review, index) => {
    if (!date(review.date) || ![1, 2, 3, 4, 5].includes(Number(review.rating))) throw new Error(`Reseña ${index + 1}: fecha o calificación inválida.`)
    if (!String(review.author ?? '').trim() || !text(review.author, 180) || !String(review.comment ?? '').trim() || !text(review.comment, 4000)) throw new Error(`Reseña ${index + 1}: autor o comentario inválido.`)
    if (!['Pendiente', 'Publicada', 'Archivada'].includes(review.status)) throw new Error(`Reseña ${index + 1}: el estado no es válido.`)
    if (!['Google', 'WhatsApp', 'Facebook', 'Instagram', 'Encuesta', 'Otro'].includes(review.channel)) throw new Error(`Reseña ${index + 1}: el canal no es válido.`)
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
  const normalizedServices = (state.services || []).map(service => ({ ...service, code: service.code || legacyServiceCode(service), category: service.category || (normalizedServiceName(service.name).startsWith('instalacion') ? 'installation' : 'service') }))
  const serviceById = new Map(normalizedServices.map(service => [String(service.id), service]))
  const serviceByName = new Map(normalizedServices.map(service => [normalizedServiceName(service.name), service]))
  const normalizeServiceReference = item => {
    const matched = serviceById.get(String(item.serviceId ?? '')) || serviceByName.get(normalizedServiceName(item.service))
    return matched ? { ...item, serviceId: matched.id, service: matched.name } : item
  }
  const completedRetirementCustomerIds = new Set((state.history || [])
    .filter(record => record.status === 'Completado' && normalizedServiceName(record.service).includes('retiro de equipo'))
    .map(record => String(record.customerId || ''))
    .filter(Boolean))
  let nextClientNumber = Math.max(0, ...(state.customers || []).map(customer => Number(String(customer.account || '').match(/^CLI-(\d+)$/i)?.[1]) || 0)) + 1
  const normalizedCustomers = (state.customers || []).map(customer => {
    const normalized = { ...customer, customerId: customer.customerId || legacyCustomerId(customer), kind: customerKind(customer), name: String(customer.name || '').replace(/\s+/g, ' ').trim().toLocaleUpperCase('es-AR') }
    if (normalized.kind !== 'subscriber' || !completedRetirementCustomerIds.has(String(normalized.customerId))) return normalized
    return { ...normalized, kind: 'client', account: `CLI-${String(nextClientNumber++).padStart(4, '0')}`, type: 'Cliente de servicio', convertedFromAccount: normalized.account, subscriptionEndedAt: new Date().toISOString() }
  })
  const customerById = new Map(normalizedCustomers.map(customer => [String(customer.customerId), customer]))
  const customerByAccount = new Map(normalizedCustomers.map(customer => [String(customer.account).trim().toUpperCase(), customer]))
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
  const normalizeTeams = (teams, month) => (teams || []).map((team, index) => normalizeTeam(team, index, month))
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
  state = { ...state, roles: normalizedRoles, employees: normalizedEmployees, services: normalizedServices, customers: normalizedCustomers, history: (state.history || []).map(normalizeHistoryRecord), agenda: { ...incomingAgenda, teams: normalizeTeams(incomingAgenda.teams, String(incomingAgenda.date || '').slice(0, 7)), weekly: normalizedWeekly } }
  validateState(state)
  const previousEmployees = new Map(rows('employees').map(employee => [String(employee.id), employee]))
  const storedAgenda = db.prepare('SELECT data FROM agendas WHERE id = ?').get('current')
  const previousAgenda = storedAgenda ? JSON.parse(storedAgenda.data) : {}
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
    auditChanges('work_history', normalizedHistory, 'id', 'Servicio / historial', user)
    auditChanges('customers', state.customers, 'customerId', 'Abonado / Cliente', user)
    auditChanges('reviews', state.reviews, 'id', 'Reseña', user)
    if (JSON.stringify(previousAgenda) !== JSON.stringify(nextAgenda)) writeAudit(user, 'Modificó', 'Agenda técnica', 'agenda-actual', previousAgenda, nextAgenda)
    replaceRows('roles', state.roles, 'id')
    replaceRows('employees', securedEmployees, 'id')
    replaceRows('services', state.services, 'id')
    replaceRows('work_history', normalizedHistory, 'id')
    replaceRows('customers', state.customers, 'account')
    replaceRows('reviews', state.reviews, 'id')
    db.prepare('INSERT OR REPLACE INTO agendas (id, data) VALUES (?, ?)').run('current', JSON.stringify(nextAgenda))
    db.prepare('INSERT OR REPLACE INTO preferences (key, value) VALUES (?, ?)').run('theme', state.preferences?.theme || 'light')
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

function requireSession(req, res) {
  const user = sessionUser(req)
  if (!user) {
    send(res, 401, { error: 'Sesión requerida.' })
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
function exportHistory(res, month, category, technicianId = null) {
  // "all" permite obtener un único reporte mensual sin perder los reportes por ubicación.
  const isAllCategories = category === 'all'
  const alarmService = rows('services').find(service => service.code === 'alarm-installation')
  const records = rows('work_history').filter(record => record.date?.startsWith(month) && (String(record.serviceId) === String(alarmService?.id) || (!record.serviceId && normalizedServiceName(record.service) === 'instalacion de alarma')) && (isAllCategories || alarmCategory(record) === category) && (!technicianId || record.technicianIds?.some(id => String(id) === String(technicianId))))
  const label = { docta: 'Docta Urbanización', 'nobu-town': 'Nobu Town', residencial: 'Residenciales', all: 'Todas las instalaciones de alarma' }[category] || 'Instalaciones de alarma'
  const headers = ['Fecha', 'Cliente', 'Dirección', 'Contacto', 'Técnicos asignados', 'Detalle', 'Equipo']
  const body = records.map(record => `<tr>${[record.date, record.client, record.address, record.phone, record.technicians?.join(' / '), record.detail, record.team].map(value => `<td>${escapeHtml(value)}</td>`).join('')}</tr>`).join('')
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>table{border-collapse:collapse;font-family:Arial}th{background:#173b28;color:#fff}th,td{border:1px solid #c8d5ca;padding:8px;text-align:left}h1{font-family:Arial;color:#173b28}</style></head><body><h1>Instalaciones de alarma – ${escapeHtml(label)}</h1><p>Período: ${escapeHtml(month)}</p><table><tr>${headers.map(header => `<th>${header}</th>`).join('')}</tr>${body}</table></body></html>`
  setSecurityHeaders(res)
  res.writeHead(200, { 'Content-Type': 'application/vnd.ms-excel; charset=utf-8', 'Content-Disposition': `attachment; filename="instalaciones-alarma-${category}-${month}.xls"` })
  res.end(html)
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${host}:${port}`)
  if (req.method === 'GET' && url.pathname === '/api/auth/session') {
    const user = sessionUser(req)
    return user ? send(res, 200, { user }) : send(res, 401, { error: 'Sin sesión activa.' })
  }
  if (req.method === 'POST' && url.pathname === '/api/auth/login') {
    if (loginLimited(req)) return send(res, 429, { error: 'Demasiados intentos. Esperá 15 minutos antes de volver a intentar.' })
    return readJson(req).then(({ email, password }) => {
      const employee = rows('employees').find(item => item.status === 'Activo' && item.email?.trim().toLowerCase() === String(email || '').trim().toLowerCase())
      const legacyPassword = Buffer.from(String(employee?.password || ''))
      const suppliedPassword = Buffer.from(String(password || ''))
      const validLegacyPassword = legacyPassword.length === suppliedPassword.length && crypto.timingSafeEqual(suppliedPassword, legacyPassword)
      const valid = employee && (employee.passwordHash ? verifyPassword(password, employee.passwordHash) : validLegacyPassword)
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
      sessions.set(token, { user, expiresAt: Date.now() + SESSION_MAX_AGE })
      // La auditoría de acceso permite conocer exactamente cuándo cada usuario ingresó.
      writeAudit(user, 'Inició sesión', 'Sesión', String(user.id), null, { sessionExpiresAt: new Date(Date.now() + SESSION_MAX_AGE).toISOString() })
      res.setHeader('Set-Cookie', `pignus_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MAX_AGE / 1000}`)
      return send(res, 200, { user })
    }).catch(() => send(res, 400, { error: 'No se pudo procesar el acceso.' }))
  }
  if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
    const token = parseCookies(req.headers.cookie).pignus_session
    const session = token && sessions.get(token)
    if (session) writeAudit(session.user, 'Cerró sesión', 'Sesión', String(session.user.id), { sessionExpiresAt: new Date(session.expiresAt).toISOString() }, null)
    if (token) sessions.delete(token)
    res.setHeader('Set-Cookie', 'pignus_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0')
    return send(res, 200, { ok: true })
  }
  if (req.method === 'GET' && url.pathname === '/api/history/export') {
    const user = requireSession(req, res)
    if (!user) return
    if (user.roleCode === 'technician') return exportHistory(res, url.searchParams.get('month') || new Date().toISOString().slice(0, 7), url.searchParams.get('category') || 'residencial', user.id)
    if (!userCan(user, 'history')) return send(res, 403, { error: 'No tenés permiso para exportar el historial.' })
    return exportHistory(res, url.searchParams.get('month') || new Date().toISOString().slice(0, 7), url.searchParams.get('category') || 'residencial')
  }
  if (req.method === 'GET' && req.url === '/api/state') {
    const user = requireSession(req, res)
    if (!user) return
    return send(res, 200, readStateForUser(user))
  }
  if (req.method === 'GET' && url.pathname === '/api/audit') {
    const user = requireSession(req, res)
    if (!user) return
    if (user.roleCode !== 'administrator') return send(res, 403, { error: 'La auditoría es exclusiva del rol Administrador.' })
    const requestedLimit = Number(url.searchParams.get('limit')) || 500
    const limit = Math.min(Math.max(requestedLimit, 1), 1000)
    return send(res, 200, { records: rows('audit_log').sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit) })
  }
  if (req.method === 'POST' && url.pathname === '/api/technician/status') {
    const user = requireSession(req, res)
    if (!user) return
    if (user.roleCode !== 'technician') return send(res, 403, { error: 'Esta acción es exclusiva del rol técnico.' })
    return readJson(req).then(({ recordId, type, observation }) => {
      const record = rows('work_history').find(item => item.id === recordId)
      const allowed = ['Completado', 'Cancelado', 'Reprogramación solicitada']
      if (!record) return send(res, 404, { error: 'El servicio no existe.' })
      const assigned = record.technicianIds?.some(id => String(id) === String(user.id))
      if (!assigned) return send(res, 403, { error: 'El servicio no está asignado al técnico autenticado.' })
      if (!allowed.includes(type) || record.technicalStatus) return send(res, 400, { error: 'No se puede actualizar este servicio.' })
      if (type !== 'Completado' && !String(observation || '').trim()) return send(res, 400, { error: 'La observación es obligatoria.' })
      const now = new Date().toISOString()
      const updated = { ...record, technicalStatus: type, technicalObservation: String(observation || '').trim(), technicalReportedAt: now, completedAt: type === 'Completado' ? now : record.completedAt, status: type === 'Completado' ? 'Completado' : 'Requiere revisión', technicianRequest: type === 'Completado' ? '' : type }
      db.exec('BEGIN')
      try {
        db.prepare('UPDATE work_history SET data = ? WHERE id = ?').run(JSON.stringify(updated), String(record.id))
        const convertedCustomer = convertCompletedRetirementSubscriber(updated)
        writeAudit(user, 'Informó estado técnico', 'Servicio / historial', String(record.id), record, updated)
        if (convertedCustomer) writeAudit(user, 'Convirtió abonado en cliente por baja', 'Abonado / Cliente', String(convertedCustomer.customerId), { account: convertedCustomer.convertedFromAccount, kind: 'subscriber' }, convertedCustomer)
        db.prepare('INSERT OR REPLACE INTO preferences (key, value) VALUES (?, ?)').run('state_revision', String(currentStateRevision() + 1))
        db.exec('COMMIT')
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
      return send(res, 200, { record: updated })
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
  send(res, 404, { error: 'Ruta no encontrada.' })
})

server.listen(port, host, () => console.log(`Base de datos disponible en http://${host}:${port}`))

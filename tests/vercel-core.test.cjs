const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const {
  authorizeIncomingState, compareReportRecords, hashPassword, normalizeRetirementCustomers, normalizeStateForSave,
  secureEmployees, statePersistenceChanged, userForEmployee, verifyPassword, visibleStateForUser
} = require('../api/_lib/core.cjs')

const roles = [
  { id: '1', code: 'administrator', name: 'Administrador', permissions: {} },
  { id: '3', code: 'technician', name: 'Técnico', permissions: {} },
  { id: '4', code: 'viewer', name: 'Consulta', permissions: { history: true } }
]

const employee = { id: 'e1', firstName: 'Ana', lastName: 'Técnica', name: 'Ana Técnica', email: 'ana@example.com', roleId: '3', role: 'Técnico', status: 'Activo' }

test('el buscador del historial técnico contempla todos los datos útiles', async () => {
  const { filterTechnicianHistory } = await import('../src/technician-history.mjs')
  const records = [
    { id: 'a', client: 'PIG-6425 LORENA MAZZAGLIA', service: 'Service de alarma', detail: 'Falsos disparos por humedad', address: 'Docta', phone: '351152022189', date: '2026-08-26', status: 'Completado' },
    { id: 'b', client: 'CLI-0093 OTRO CLIENTE', service: 'Instalación de cámaras', detail: 'Cambio de equipos', date: '2026-01-02', status: 'Cancelado' }
  ]

  for (const query of ['lorena', 'PIG-6425', 'alarma humedad', 'docta', '351152022189', '26 agosto 2026', 'completado']) {
    assert.deepEqual(filterTechnicianHistory(records, query).map(record => record.id), ['a'])
  }
  assert.deepEqual(filterTechnicianHistory(records, 'camaras cancelado').map(record => record.id), ['b'])
  assert.deepEqual(filterTechnicianHistory(records, 'registro inexistente'), [])
})

test('el acceso cancela solicitudes bloqueadas y permite reintentar', async () => {
  const { AUTH_REQUEST_TIMEOUT_MS, fetchWithTimeout } = await import('../src/fetch-timeout.mjs')
  assert.equal(AUTH_REQUEST_TIMEOUT_MS, 15_000)
  let aborted = false
  const hangingFetch = (resource, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => {
      aborted = true
      const error = new Error('aborted')
      error.name = 'AbortError'
      reject(error)
    })
  })
  await assert.rejects(fetchWithTimeout('/api/auth/login', {}, 5, hangingFetch), /La conexión demoró demasiado/)
  assert.equal(aborted, true)

  const response = { ok: true }
  assert.equal(await fetchWithTimeout('/api/auth/session', {}, 100, async () => response), response)
})

test('el estado técnico reintenta una indisponibilidad temporal sin duplicar el contenido', async () => {
  const { submitTechnicianStatus } = await import('../src/technician-status.mjs')
  const requests = []
  const fetcher = async (_url, options) => {
    requests.push(JSON.parse(options.body))
    if (requests.length === 1) return { ok: false, status: 503, json: async () => ({ error: 'Base ocupada' }) }
    return { ok: true, status: 200, json: async () => ({ record: { id: 'service-1', status: 'Completado' } }) }
  }

  const record = await submitTechnicianStatus({ recordId: 'service-1', type: 'Completado', observation: 'Trabajo realizado.', fetcher, retryDelay: 0 })
  assert.equal(record.status, 'Completado')
  assert.equal(requests.length, 2)
  assert.deepEqual(requests[0], requests[1])
})

test('el estado técnico conserva el error funcional y no lo reintenta', async () => {
  const { submitTechnicianStatus } = await import('../src/technician-status.mjs')
  let requests = 0
  const fetcher = async () => {
    requests += 1
    return { ok: false, status: 409, json: async () => ({ error: 'Este servicio ya fue informado desde otra sesión.' }) }
  }

  await assert.rejects(
    submitTechnicianStatus({ recordId: 'service-1', type: 'Completado', observation: '', fetcher, retryDelay: 0 }),
    /otra sesión/
  )
  assert.equal(requests, 1)
})

test('la confirmación espera el guardado y el servidor admite reintentos idempotentes', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/App.jsx'), 'utf8')
  const apiSource = fs.readFileSync(path.resolve(__dirname, '../api/index.js'), 'utf8')
  assert.match(source, /await action\(\)/)
  assert.match(source, /submitting \? 'Guardando…' : label/)
  assert.match(source, /role="alert"/)
  assert.match(source, /window\.setInterval\(refreshSharedAgenda, 30000\)/)
  assert.match(apiSource, /set local lock_timeout = '5s'/)
  assert.match(apiSource, /record\.technicalStatus === type/)
  assert.match(apiSource, /technicalReportedById\) === String\(user\.id\)/)
})

test('el historial prioriza fecha reciente, pendientes y horario temprano', async () => {
  const { sortOperationalHistory } = await import('../src/history-order.mjs')
  const records = [
    { id: 'older-pending', date: '2026-08-26', time: '08:00', status: 'Pendiente', client: 'Cliente anterior' },
    { id: 'completed-early', date: '2026-08-27', time: '08:30', status: 'Completado', client: 'Completado' },
    { id: 'pending-late', date: '2026-08-27', time: '13:00', status: 'Pendiente', client: 'Pendiente tarde' },
    { id: 'pending-early', date: '2026-08-27', time: '09:30', status: 'Pendiente', client: 'Pendiente temprano' },
    { id: 'review', date: '2026-08-27', time: '10:00', status: 'Requiere revisión', client: 'Revisión' },
    { id: 'pending-no-time', date: '2026-08-27', status: 'Pendiente', client: 'Sin horario' }
  ]
  assert.deepEqual(records.sort(sortOperationalHistory).map(record => record.id), ['pending-early', 'review', 'pending-late', 'pending-no-time', 'completed-early', 'older-pending'])
})

test('el historial muestra la hora asignada como una columna propia', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/App.jsx'), 'utf8')
  const styles = fs.readFileSync(path.resolve(__dirname, '../src/ui-polish.css'), 'utf8')
  assert.match(source, /<span>Hora<\/span>/)
  assert.match(source, /Hora asignada:/)
  assert.match(source, /sort\(sortOperationalHistory\)/)
  assert.match(styles, /\.history-bulk \.history-time/)
})

test('el técnico usa el mismo menú móvil desplegable que los demás roles', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/App.jsx'), 'utf8')
  const styles = fs.readFileSync(path.resolve(__dirname, '../src/style.css'), 'utf8')
  assert.match(source, /sidebar technician-sidebar/)
  assert.match(source, /technician-mobile-menu/)
  assert.match(source, /setMenuOpen\(true\)/)
  assert.match(source, /backdrop/)
  assert.match(styles, /@media\(max-width:640px\)\{\.technician-sidebar\{display:flex;z-index:8\}/)
})

test('el control para compactar la barra lateral no se activa en smartphones', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/App.jsx'), 'utf8')
  const styles = fs.readFileSync(path.resolve(__dirname, '../src/weekly-enhancements.css'), 'utf8')
  assert.match(source, /matchMedia\?\.\('\(min-width: 641px\)'\)/)
  assert.match(source, /classList\.toggle\('sidebar-collapsed', desktopSidebar && sidebarCollapsed\)/)
  assert.match(source, /if \(!desktopSidebar\) return undefined/)
  assert.doesNotMatch(source, /zIndex: '20', display: 'grid'/)
  assert.match(styles, /\.sidebar-collapse-toggle \{\s*display: none !important;/)
  assert.match(styles, /\.sidebar\.sidebar-compact nav button::after \{\s*display: none;\s*content: none;/)
})

test('la evolución anual oculta meses futuros y conserva años cerrados', async () => {
  const { visibleAnnualMonthLabels } = await import('../src/annual-chart.mjs')
  const august2026 = new Date(2026, 7, 26, 12)
  assert.deepEqual(visibleAnnualMonthLabels('2026', august2026), ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago'])
  assert.equal(visibleAnnualMonthLabels('2025', august2026).length, 12)
  assert.deepEqual(visibleAnnualMonthLabels('2027', august2026), [])
})

test('el menú principal acumula instalaciones de alarma de Docta desde enero hasta hoy', async () => {
  const { countYearToDateAlarmInstallations, countYearToDateCompletedRecords } = await import('../src/dashboard-metrics.mjs')
  const records = [
    { id: 'jan', date: '2026-01-10', status: 'Completado', alarm: true, zone: 'docta' },
    { id: 'today', date: '2026-08-27', status: 'Completado', alarm: true, zone: 'docta' },
    { id: 'future', date: '2026-09-01', status: 'Completado', alarm: true, zone: 'docta' },
    { id: 'pending', date: '2026-05-01', status: 'Pendiente', alarm: true, zone: 'docta' },
    { id: 'service', date: '2026-05-02', status: 'Completado', alarm: false, zone: 'docta' },
    { id: 'nobu', date: '2026-05-03', status: 'Completado', alarm: true, zone: 'nobu-town' },
    { id: 'previous-year', date: '2025-12-31', status: 'Completado', alarm: true, zone: 'docta' }
  ]
  const total = countYearToDateAlarmInstallations(records, {
    throughDate: '2026-08-27',
    isAlarmRecord: record => record.alarm,
    zoneOf: record => record.zone
  })
  assert.equal(total, 2)

  assert.equal(countYearToDateCompletedRecords(records, {
    throughDate: '2026-08-27',
    matches: record => record.id === 'today' || record.id === 'future' || record.id === 'pending'
  }), 1)

  const source = fs.readFileSync(path.resolve(__dirname, '../src/App.jsx'), 'utf8')
  assert.match(source, /Desde el 1 de enero hasta hoy · \{currentYear\}/)
  assert.match(source, /Instalaciones en Docta/)
  assert.match(source, /Instalaciones en Nobu Town/)
  assert.match(source, /Instalaciones residenciales/)
  assert.match(source, /annualRetirements/)
})

test('las exportaciones usan una descarga compatible con navegadores móviles', async () => {
  const { reportDownloadName, triggerBrowserDownload } = await import('../src/browser-download.mjs')
  const created = []
  const appended = []
  const documentRef = {
    body: { append: element => appended.push(element) },
    createElement: tag => {
      const element = { tag, style: {}, clicked: false, removed: false, click() { this.clicked = true }, remove() { this.removed = true } }
      created.push(element)
      return element
    }
  }
  triggerBrowserDownload('/api/history/export?format=pdf', 'reporte.pdf', documentRef)
  assert.equal(created[0].tag, 'a')
  assert.equal(created[0].download, 'reporte.pdf')
  assert.equal(created[0].target, '_blank')
  assert.equal(created[0].clicked, true)
  assert.equal(created[0].removed, true)
  assert.deepEqual(appended, created)
  assert.equal(reportDownloadName('2026-08', 'all'), 'instalaciones-alarma-all-2026-08.xls')
  assert.equal(reportDownloadName('2026-08', 'retirements', 'pdf'), 'bajas-servicio-2026-08.pdf')
})

test('la agenda diaria restablece una grilla angosta en smartphones', () => {
  const styles = fs.readFileSync(path.resolve(__dirname, '../src/ui-polish.css'), 'utf8')
  assert.match(styles, /\.content > \.team-card \.task-row \{[\s\S]*?grid-template-columns: minmax\(76px, \.7fr\) minmax\(0, 1\.3fr\) !important;/)
  assert.match(styles, /\.content > \.team-card \.task-row > label:nth-of-type\(1\) \{\s*grid-column: 1 !important;/)
  assert.match(styles, /\.content > \.team-card \.task-row > label:nth-of-type\(2\) \{\s*grid-column: 2 !important;/)
  assert.match(styles, /\.content > \.team-card \.task-row > \.customer-autocomplete,[\s\S]*?grid-column: 1 \/ -1 !important;/)
  assert.match(styles, /\.app-shell > main \{[\s\S]*?overflow-x: clip;/)
})

test('todos los roles comparten protecciones responsive para controles y modales', () => {
  const styles = fs.readFileSync(path.resolve(__dirname, '../src/ui-polish.css'), 'utf8')
  assert.match(styles, /zoom automático[\s\S]*?font-size: 16px;/)
  assert.match(styles, /button \{\s*min-height: 44px !important;/)
  assert.match(styles, /\.audit-row \{\s*min-width: 0;\s*grid-template-columns: minmax\(0, 1fr\) auto;/)
  assert.match(styles, /max-height: calc\(100dvh - 20px\)/)
  assert.match(styles, /\.history-edit-grid,[\s\S]*?\.monthly-team-list \{\s*grid-template-columns: minmax\(0, 1fr\) !important;/)
  assert.match(styles, /\.technician-header,[\s\S]*?\.technician-history-search \{\s*width: 100%;/)
  assert.match(styles, /\.mobile-menu,[\s\S]*?\.technician-header-nav button\) \{\s*min-height: 44px !important;/)
  assert.match(styles, /\.weekly-remove-team,[\s\S]*?\.weekly-task-delete,[\s\S]*?min-height: 44px !important;/)
  assert.match(styles, /\.profile-trigger,[\s\S]*?\.logout-button,[\s\S]*?min-width: 44px !important;/)
  assert.match(styles, /\.history-toolbar > label,[\s\S]*?flex: 0 0 auto;/)
})

test('los controles nativos permanecen contenidos dentro de todos los modales', () => {
  const styles = fs.readFileSync(path.resolve(__dirname, '../src/ui-polish.css'), 'utf8')
  assert.match(styles, /Contención transversal:[\s\S]*?\.weekly-task-modal[\s\S]*?min-width: 0;[\s\S]*?max-width: 100%;/)
  assert.match(styles, /:not\(\[type='checkbox'\]\):not\(\[type='radio'\]\) \{\s*width: 100%;/)
  assert.match(styles, /input\[type='time'\],[\s\S]*?input\[type='date'\],[\s\S]*?input\[type='month'\][\s\S]*?min-inline-size: 0;/)
  assert.match(styles, /\.weekly-task-modal \.week-task-top \{\s*grid-template-columns: minmax\(132px, \.36fr\) minmax\(0, 1fr\);/)
  assert.match(styles, /@media \(max-width: 640px\)[\s\S]*?\.weekly-task-modal \.week-task-top \{\s*grid-template-columns: minmax\(0, 1fr\) !important;/)
})

test('los campos obligatorios usan un único indicador junto a la etiqueta', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/App.jsx'), 'utf8')
  const styles = fs.readFileSync(path.resolve(__dirname, '../src/ui-polish.css'), 'utf8')
  const legacyStyles = fs.readFileSync(path.resolve(__dirname, '../src/style.css'), 'utf8')
  assert.match(source, /function RequiredLabel\(\{ children \}\)/)
  assert.doesNotMatch(source, /<b>\s*\*\s*<\/b>/)
  assert.doesNotMatch(legacyStyles, /task-row>label:nth-of-type\(1\)::after/)
  assert.doesNotMatch(legacyStyles, /installation-zone legend::after/)
  assert.match(styles, /span\.field-label-text \{[\s\S]*?display: inline-flex;[\s\S]*?align-items: baseline;/)
  assert.match(styles, /span\.field-label-text > span\.required-mark,[\s\S]*?color: #b93832;/)
  assert.match(source, /<RequiredLabel>Hora<\/RequiredLabel>/)
  assert.match(source, /<RequiredLabel>Correo electrónico<\/RequiredLabel>/)
  assert.match(source, /<RequiredLabel>Observación<\/RequiredLabel>/)
})

test('la evolución anual reserva espacio para valores y separa la leyenda', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/App.jsx'), 'utf8')
  const styles = fs.readFileSync(path.resolve(__dirname, '../src/ui-polish.css'), 'utf8')
  assert.match(source, /value \/ max \* 78/)
  assert.match(source, /stack\.style\.height = `\$\{chartHeightPercent\(monthData\?\.value\)\}%`/)
  assert.match(styles, /\.annual-chart \.chart-legend \{[\s\S]*?margin: 0 5px 20px;/)
  assert.match(styles, /\.annual-chart \.bar-chart \{[\s\S]*?padding-top: 10px;/)
})

test('configura formulario, forma de pago y monto según el servicio', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/App.jsx'), 'utf8')
  assert.match(source, /PAYMENT_OPTIONS = \['Efectivo', 'Transferencia', 'Débito', 'Crédito', 'A confirmar', 'No aplica'\]/)
  assert.match(source, /form: alarmInstallation \|\| ownershipChange/)
  assert.match(source, /!\['A confirmar', 'No aplica'\]\.includes\(paymentMethod\)/)
  assert.match(source, /task\.paymentMethod !== 'No aplica'/)
  assert.match(source, /event\.target\.value === 'No aplica' \? \{ amount: '' \}/)
  assert.match(source, /if \(key === 'amount' && !enabled\) return null/)
  assert.match(source, /amount: paymentMethod && paymentMethod !== 'No aplica' \? task\?\.amount \|\| '' : ''/)
  assert.match(source, /requiresPaymentAmount\(task, serviceForTask\(task\)\)/)
  assert.match(source, /requiresPaymentAmount\(draft, serviceForWeeklyTask\(draft\)\)/)
})

test('permite copiar un servicio individual de la agenda diaria', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/App.jsx'), 'utf8')
  const styles = fs.readFileSync(path.resolve(__dirname, '../src/ui-polish.css'), 'utf8')
  assert.match(source, /const copyTextToClipboard = async text =>/)
  assert.match(source, /const individualTaskMessage = \(task, team, teamIndex\) =>/)
  assert.match(source, /const copySingleTask = async \(task, team, teamIndex, taskIndex\) =>/)
  assert.match(source, /className="icon-btn daily-copy-button"/)
  assert.match(source, /title="Copiar este servicio"/)
  assert.match(source, /No se pudo acceder al portapapeles/)
  assert.match(styles, /\.task-row > \.daily-task-actions/)
  assert.match(styles, /grid-template-columns: repeat\(auto-fit, minmax\(96px, 1fr\)\)/)
})

test('ordena los campos y centra las acciones de cada servicio diario', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/App.jsx'), 'utf8')
  const styles = fs.readFileSync(path.resolve(__dirname, '../src/ui-polish.css'), 'utf8')
  assert.match(source, /className="daily-field-time"/)
  assert.match(source, /className="daily-field-service"/)
  assert.match(source, /className="daily-field-address"/)
  assert.match(source, /className="daily-field-contact"/)
  assert.match(source, /className="observations daily-field-observations"/)
  assert.match(source, /className="icon-btn move daily-move-button"/)
  assert.doesNotMatch(source, /document\.querySelectorAll\('\.content \.team-card \.task-row'\)/)
  assert.match(styles, /\.content > \.team-card \.task-row > \.daily-field-observations \{[\s\S]*?grid-column: 2 \/ 5 !important;/)
  assert.match(styles, /\.content > \.team-card \.task-row > \.daily-task-actions \{[\s\S]*?align-self: stretch;[\s\S]*?justify-content: center;/)
})

test('genera y verifica hashes compatibles con las credenciales existentes', () => {
  const hash = hashPassword('Prueba1234')
  assert.equal(verifyPassword('Prueba1234', hash), true)
  assert.equal(verifyPassword('Incorrecta123', hash), false)
})

test('resuelve el rol y limita el estado visible del técnico', () => {
  const user = userForEmployee(employee, roles)
  const state = { revision: 4, roles, employees: [employee], services: [], customers: [], agenda: {}, preferences: {}, history: [{ id: 'a', technicianIds: ['e1'] }, { id: 'b', technicianIds: ['e2'] }] }
  const visible = visibleStateForUser(state, user)
  assert.deepEqual(visible.history.map(record => record.id), ['a'])
  assert.equal(visible.agenda, null)
  assert.deepEqual(visible.customers, [])
})

test('el técnico recibe contexto histórico sólo de clientes con trabajos vigentes asignados', () => {
  const user = userForEmployee(employee, roles)
  const state = {
    revision: 7, roles, employees: [employee], services: [], customers: [], agenda: {}, preferences: {},
    history: [
      { id: 'assigned-current', date: '2999-01-10', status: 'Pendiente', customerId: 'customer-a', clientAccount: 'PIG-100', technicianIds: ['e1'] },
      { id: 'same-customer-previous', date: '2025-01-10', status: 'Completado', customerId: 'customer-a', clientAccount: 'PIG-100', technicianIds: ['e2'], technicalObservation: 'Revisar magnético.' },
      { id: 'same-account-legacy', date: '2024-01-10', status: 'Completado', client: 'PIG-100 CLIENTE HISTÓRICO', technicianIds: ['e3'] },
      { id: 'own-old', date: '2023-01-10', status: 'Completado', customerId: 'customer-b', technicianIds: ['e1'] },
      { id: 'unrelated', date: '2025-01-10', status: 'Completado', customerId: 'customer-z', clientAccount: 'PIG-999', technicianIds: ['e2'] }
    ]
  }
  const visible = visibleStateForUser(state, user)
  assert.deepEqual(visible.history.map(record => record.id), ['assigned-current', 'same-customer-previous', 'same-account-legacy', 'own-old'])
  assert.deepEqual(visible.customers, [])
  assert.equal(visible.history.some(record => record.id === 'unrelated'), false)
})

test('vincula abonados con su historial y conserva autoría de las observaciones técnicas', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/App.jsx'), 'utf8')
  const apiSource = fs.readFileSync(path.resolve(__dirname, '../api/index.js'), 'utf8')
  const styles = fs.readFileSync(path.resolve(__dirname, '../src/ui-polish.css'), 'utf8')
  assert.match(source, /serviceHistoryForCustomer/)
  assert.match(source, /Ver historial de servicios/)
  assert.match(source, /Ver historial del cliente/)
  assert.match(source, /CONSULTA TÉCNICA · SOLO LECTURA/)
  assert.match(source, /Observación de agenda \/ administración/)
  assert.match(source, /Observación técnica \(opcional\)/)
  assert.match(apiSource, /technicalReportedById: user\.id/)
  assert.match(apiSource, /technicalReportedByName: user\.name/)
  assert.match(styles, /\.customer-history-modal/)
})

test('ignora roles nulos al resolver una sesión', () => {
  const user = userForEmployee(employee, [null, undefined, ...roles])
  assert.equal(user.id, employee.id)
  assert.equal(user.roleCode, 'technician')
  assert.equal(userForEmployee(employee, [null]), null)
})

test('dos sesiones simultáneas no crean revisiones al guardar el mismo estado', () => {
  const current = { roles, employees: [employee], services: [], customers: [], history: [], reviews: [], agenda: { date: '2026-08-25', teams: [], weekly: {} }, preferences: { theme: 'light' } }
  let revision = 12
  const save = (sessionRevision, next) => {
    if (!statePersistenceChanged(current, next)) return revision
    if (sessionRevision !== revision) throw new Error('conflict')
    revision += 1
    return revision
  }

  assert.equal(save(12, structuredClone(current)), 12)
  assert.equal(save(12, structuredClone(current)), 12)
  assert.equal(save(12, { ...structuredClone(current), preferences: { theme: 'light' }, agenda: { weekly: {}, teams: [], date: '2026-08-25' } }), 12)
  assert.equal(revision, 12)
  assert.equal(statePersistenceChanged(current, { ...current, agenda: { ...current.agenda, date: '2026-08-26' } }), true)
})

test('impide que un rol de consulta modifique colecciones sin permiso', () => {
  const user = userForEmployee({ ...employee, roleId: '4', role: 'Consulta' }, roles)
  const current = { roles, employees: [employee], services: [{ id: 1 }], customers: [{ account: 'CLI-1' }], history: [{ id: 'old' }], reviews: [], agenda: { date: '2026-01-01', teams: [], weekly: {} } }
  const incoming = { ...current, services: [], customers: [], history: [], agenda: { date: '2030-01-01', teams: [{ teamId: 'x' }], weekly: {} } }
  const authorized = authorizeIncomingState(incoming, current, user)
  assert.deepEqual(authorized.services, current.services)
  assert.deepEqual(authorized.customers, current.customers)
  assert.deepEqual(authorized.agenda, current.agenda)
})

test('conserva el hash al editar un empleado sin cambiar su contraseña', () => {
  const passwordHash = hashPassword('Prueba1234')
  const current = [{ ...employee, passwordHash }]
  const normalized = normalizeStateForSave({ roles, employees: [{ ...employee, lastName: 'Actualizada' }], services: [], customers: [], history: [], reviews: [], agenda: {} }, { reviews: [] })
  const secured = secureEmployees(normalized.employees, current)
  assert.equal(secured[0].passwordHash, passwordHash)
  assert.equal(secured[0].name, 'Ana Actualizada')
})

test('ordena reportes desde la fecha más reciente y por hora dentro del día', () => {
  const records = [
    { id: 'old', date: '2026-01-01', time: '08:00' },
    { id: 'late', date: '2026-01-03', time: '15:00' },
    { id: 'early', date: '2026-01-03', time: '08:00' }
  ].sort(compareReportRecords)
  assert.deepEqual(records.map(record => record.id), ['early', 'late', 'old'])
})

test('convierte el abonado y todas sus referencias al completar una baja', () => {
  const state = {
    customers: [{ customerId: 'c1', account: 'PIG-001', name: 'CLIENTE', kind: 'subscriber' }],
    history: [{ id: 'h1', customerId: 'c1', clientAccount: 'PIG-001', service: 'Retiro de equipo de alarma', status: 'Completado' }],
    reviews: [],
    agenda: { teams: [{ tasks: [{ customerId: 'c1', clientAccount: 'PIG-001' }] }], weekly: {} }
  }
  const result = normalizeRetirementCustomers(state)
  assert.equal(result.conversions.length, 1)
  assert.equal(result.state.customers[0].account, 'CLI-0001')
  assert.equal(result.state.history[0].clientAccount, 'CLI-0001')
  assert.equal(result.state.agenda.teams[0].tasks[0].clientAccount, 'CLI-0001')
})

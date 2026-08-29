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

test('declara los hooks usados por la alerta de recuperación de contraseña', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/App.jsx'), 'utf8')
  assert.match(source, /import React, \{[^}]*useCallback[^}]*\} from 'react'/)
  assert.match(source, /function PasswordResetReminder/)
})

test('el acceso explica las credenciales sin mencionar módulos restringidos', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/App.jsx'), 'utf8')
  assert.match(source, /Usá el correo y la contraseña definidos por el administrador\./)
  assert.doesNotMatch(source, /Usá el correo y la contraseña definidos en el módulo Empleados\./)
})

test('el buscador del historial técnico contempla todos los datos útiles', async () => {
  const { filterTechnicianHistory, technicianTeamLabel } = await import('../src/technician-history.mjs')
  const records = [
    { id: 'a', client: 'PIG-6425 LORENA MAZZAGLIA', service: 'Service de alarma', detail: 'Falsos disparos por humedad', address: 'Docta', phone: '351152022189', date: '2026-08-26', status: 'Completado' },
    { id: 'b', client: 'CLI-0093 OTRO CLIENTE', service: 'Instalación de cámaras', detail: 'Cambio de equipos', date: '2026-01-02', status: 'Cancelado' }
  ]

  for (const query of ['lorena', 'PIG-6425', 'alarma humedad', 'docta', '351152022189', '26 agosto 2026', 'completado']) {
    assert.deepEqual(filterTechnicianHistory(records, query).map(record => record.id), ['a'])
  }
  assert.deepEqual(filterTechnicianHistory(records, 'camaras cancelado').map(record => record.id), ['b'])
  assert.deepEqual(filterTechnicianHistory(records, 'registro inexistente'), [])
  assert.equal(technicianTeamLabel({ team: 'Equipo 1', technicians: ['Rodrigo Gonzalez', 'Mariano Diaz Tillard'] }), 'Equipo 1 · Rodrigo Gonzalez / Mariano Diaz Tillard')
  assert.equal(technicianTeamLabel({ technicians: ['Rodrigo Gonzalez', 'Rodrigo Gonzalez'] }), 'Rodrigo Gonzalez')
})

test('el acceso cancela solicitudes bloqueadas y permite reintentar', async () => {
  const { AUTH_LOGIN_TIMEOUT_MS, AUTH_REQUEST_TIMEOUT_MS, fetchAuthWithRetry, fetchWithTimeout } = await import('../src/fetch-timeout.mjs')
  assert.equal(AUTH_REQUEST_TIMEOUT_MS, 15_000)
  assert.equal(AUTH_LOGIN_TIMEOUT_MS, 30_000)
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

  let attempts = 0
  const recovered = await fetchAuthWithRetry('/api/auth/session', {}, 100, async () => {
    attempts += 1
    if (attempts === 1) {
      const error = new Error('offline')
      error.name = 'TypeError'
      throw error
    }
    return { ok: true, status: 200 }
  }, 0)
  assert.equal(recovered.ok, true)
  assert.equal(attempts, 2)

  attempts = 0
  const rejectedCredentials = await fetchAuthWithRetry('/api/auth/login', {}, 100, async () => {
    attempts += 1
    return { ok: false, status: 401 }
  }, 0)
  assert.equal(rejectedCredentials.status, 401)
  assert.equal(attempts, 1)
})

test('un fallo del recordatorio de contraseñas no se muestra como pérdida general de conexión', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'src', 'App.jsx'), 'utf8')
  const reminder = source.slice(source.indexOf('function PasswordResetReminder'), source.indexOf('function DashboardStatusView'))
  assert.match(reminder, /console\.warn\('No se pudieron actualizar las solicitudes de contraseña\.'/)
  assert.doesNotMatch(reminder, /catch \(loadError\) \{ setError\(loadError\.message\) \}/)
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
    submitTechnicianStatus({ recordId: 'service-1', type: 'Completado', observation: 'Trabajo informado.', fetcher, retryDelay: 0 }),
    /otra sesión/
  )
  assert.equal(requests, 1)
})

test('el técnico no puede informar un servicio sin observación', async () => {
  const { submitTechnicianStatus } = await import('../src/technician-status.mjs')
  let requests = 0
  await assert.rejects(
    submitTechnicianStatus({ recordId: 'service-1', type: 'Completado', observation: '   ', fetcher: async () => { requests += 1 } }),
    /observación es obligatoria/i
  )
  assert.equal(requests, 0)

  const source = fs.readFileSync(path.resolve(__dirname, '../src/App.jsx'), 'utf8')
  assert.match(source, /<RequiredLabel>Observación<\/RequiredLabel>/)
  assert.match(source, /disabled=\{!observation\.trim\(\)\}/)
  assert.doesNotMatch(source, /Observación técnica \(opcional\)/)
})

test('el control vehicular permite enviar foto y kilometraje sin observación', async () => {
  const { submitTechnicianStatus } = await import('../src/technician-status.mjs')
  let body
  const fetcher = async (_url, options) => {
    body = JSON.parse(options.body)
    return { ok: true, status: 200, json: async () => ({ record: { id: 'vehicle-control-1', vehicleMileage: 123456 } }) }
  }
  const record = await submitTechnicianStatus({ recordId: 'vehicle-control-1', type: 'Completado', observation: '', vehicleMileage: 123456, vehiclePhoto: 'data:image/jpeg;base64,YQ==', vehicleControl: true, fetcher })
  assert.equal(record.vehicleMileage, 123456)
  assert.equal(body.vehicleMileage, 123456)
  assert.match(body.vehiclePhoto, /^data:image\/jpeg/)
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

test('el historial muestra primero los pendientes desde la fecha y hora más antiguas', async () => {
  const { sortOperationalHistory } = await import('../src/history-order.mjs')
  const records = [
    { id: 'completed-friday', date: '2026-08-28', time: '08:30', status: 'Completado', client: 'Completado viernes' },
    { id: 'completed-monday', date: '2026-08-31', time: '08:30', status: 'Completado', client: 'Completado lunes' },
    { id: 'cancelled-later', date: '2026-09-01', time: '08:30', status: 'Cancelado', client: 'Cancelado posterior' },
    { id: 'monday-early', date: '2026-08-31', time: '08:30', status: 'Pendiente', client: 'Lunes temprano' },
    { id: 'friday-late', date: '2026-08-28', time: '13:00', status: 'Pendiente', client: 'Viernes tarde' },
    { id: 'friday-early', date: '2026-08-28', time: '08:30', status: 'Pendiente', client: 'Viernes temprano' },
    { id: 'review', date: '2026-08-28', time: '10:00', status: 'Requiere revisión', client: 'Revisión' },
    { id: 'friday-no-time', date: '2026-08-28', status: 'Pendiente', client: 'Sin horario' }
  ]
  assert.deepEqual(records.sort(sortOperationalHistory).map(record => record.id), ['friday-early', 'review', 'friday-late', 'friday-no-time', 'monday-early', 'completed-monday', 'completed-friday', 'cancelled-later'])
})

test('el historial muestra la hora asignada como una columna propia', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/App.jsx'), 'utf8')
  const styles = fs.readFileSync(path.resolve(__dirname, '../src/ui-polish.css'), 'utf8')
  assert.match(source, /<span>Hora<\/span>/)
  assert.match(source, /Hora asignada:/)
  assert.match(source, /sort\(sortOperationalHistory\)/)
  assert.match(styles, /\.history-bulk \.history-time/)
  assert.match(styles, /\.history-bulk \.role-chip \{[\s\S]*display: inline-block;[\s\S]*width: fit-content;/)
})

test('el botón Editar datos conserva el icono y el texto dentro de su marco', () => {
  const styles = fs.readFileSync(path.resolve(__dirname, '../src/ui-polish.css'), 'utf8')
  assert.match(styles, /\.history-detail-heading > \.detail-edit \{[\s\S]*?flex: 0 0 auto;[\s\S]*?min-width: max-content !important;[\s\S]*?min-height: 40px;[\s\S]*?white-space: nowrap;/)
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
  assert.match(styles, /\.vehicle-control-blocker-banner \{[\s\S]*?width: 100%;[\s\S]*?max-width: 100%;[\s\S]*?overflow-wrap: anywhere;/)
  assert.match(styles, /\.vehicle-control-report-fields input \{[\s\S]*?min-block-size: 48px !important;/)
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
  assert.match(source, /const formatCurrencyAmount = value =>/)
  assert.match(source, /toLocaleString\('es-AR'/)
  assert.match(source, /<CurrencyInput \{\.\.\.amountProps\}/)
  assert.match(source, /`Monto: \$\{previewValue\(formatCurrencyAmount\(extras\.amount\)\)\}`/)
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

test('la agenda diaria renderiza sus acciones inmediatamente y separa hora de servicio', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/App.jsx'), 'utf8')
  const styles = fs.readFileSync(path.resolve(__dirname, '../src/ui-polish.css'), 'utf8')
  assert.match(source, /className="secondary save-agenda-button" onClick=\{saveAgenda\}/)
  assert.doesNotMatch(source, /actionGroup\.querySelector\('\.save-agenda-button'\)\?\.remove\(\)/)
  assert.match(source, /taskHasContent\(task\) && <button type="button" className="icon-btn delete daily-delete-button"/)
  assert.match(styles, /grid-template-columns: 132px minmax\(220px, 1fr\) minmax\(220px, 1fr\)/)
  assert.match(styles, /\.daily-field-time input\[type='time'\] \{[\s\S]*?max-width: 100%;/)
  assert.match(styles, /label\.daily-field-time,[\s\S]*?label\.daily-field-service \{\s*grid-column: 1 \/ -1 !important;/)
})

test('la agenda diaria respeta espacios quitados y no copia servicios vacíos', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/App.jsx'), 'utf8')
  assert.match(source, /const visibleWeeklyTeams = applyRemovedWeeklySlots\(weeklyDay\?\.teams \|\| \[\], weeklyDay\?\.removedSlots \|\| \[\]\)/)
  assert.match(source, /const agendaTeamsWithRealServices = \(agendaTeams = teams\) => agendaTeams\.map\(team => \(\{[\s\S]*?tasks: \(team\.tasks \|\| \[\]\)\.filter\(taskHasContent\)/)
  assert.match(source, /const messageSections = teams\.flatMap\(\(team, index\) => team\.tasks\.some\(taskHasContent\)/)
  assert.match(source, /agendaTeams = agendaTeamsWithRealServices\(agendaTeams\)/)
})

test('las agendas diaria y semanal renderizan directamente el estado de cada servicio', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/App.jsx'), 'utf8')
  const polishStyles = fs.readFileSync(path.resolve(__dirname, '../src/ui-polish.css'), 'utf8')
  const weeklyStyles = fs.readFileSync(path.resolve(__dirname, '../src/weekly-enhancements.css'), 'utf8')
  assert.match(source, /function TaskStatusBadge\(\{ task, date, history, weekly = false \}\)/)
  assert.match(source, /<TaskStatusBadge task=\{task\} date=\{date\} history=\{history\} \/>/)
  assert.match(source, /<TaskStatusBadge task=\{task\} date=\{day\} history=\{operationalHistory\} weekly \/>/)
  assert.doesNotMatch(source, /appendTaskStatusElement/)
  assert.match(polishStyles, /\.daily-agenda-task-status \{[\s\S]*?grid-column: 1;[\s\S]*?grid-row: 2;/)
  assert.match(weeklyStyles, /:not\(\.agenda-task-status\)/)
})

test('la agenda semanal muestra el tipo de servicio junto al estado y la diaria muestra solo el estado', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/App.jsx'), 'utf8')
  const polishStyles = fs.readFileSync(path.resolve(__dirname, '../src/ui-polish.css'), 'utf8')
  const weeklyStyles = fs.readFileSync(path.resolve(__dirname, '../src/weekly-enhancements.css'), 'utf8')
  assert.match(source, /className=\{`role-chip agenda-service-chip \$\{serviceColorClass\(service\)\}`\}/)
  assert.match(source, /\{weekly && <em className=\{`role-chip agenda-service-chip/)
  assert.match(source, /title=\{service\}>\{service\}<\/em>/)
  assert.match(polishStyles, /\.agenda-task-status \{[\s\S]*?display: flex;[\s\S]*?gap: 6px;/)
  assert.match(polishStyles, /\.agenda-task-status > \.agenda-service-chip \{[\s\S]*?text-overflow: ellipsis;/)
  assert.match(polishStyles, /\.agenda-service-chip\.service-alarm \{ background: #e1edff; color: #315d98; \}/)
  assert.match(polishStyles, /\.agenda-service-chip\.service-ownership \{ background: #fff1c9; color: #8a6500; \}/)
  assert.match(weeklyStyles, /\.week-task-summary > \.weekly-agenda-task-status \{[\s\S]*?display: flex;/)
})

test('la agenda diaria mantiene visibles los nombres de los técnicos del equipo', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/App.jsx'), 'utf8')
  const styles = fs.readFileSync(path.resolve(__dirname, '../src/ui-polish.css'), 'utf8')
  assert.match(source, /className="daily-team-identity"/)
  assert.match(source, /className="daily-team-member-names"[\s\S]*?team\.members\.map\(name =>[\s\S]*?\.join\(' · '\)/)
  assert.doesNotMatch(source, /dataset\.technicianNames|insertAdjacentElement\('afterend', names\)/)
  assert.match(styles, /\.daily-team-member-names \{[\s\S]*?text-overflow: ellipsis;[\s\S]*?white-space: nowrap;/)
})

test('los horarios predeterminados cambian desde septiembre sin alterar servicios cargados', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/App.jsx'), 'utf8')
  assert.match(source, /DEFAULT_SERVICE_TIME_CHANGE_DATE = '2026-09-01'/)
  assert.match(source, /fallbackDefaultServiceTimesForDate = date =>[\s\S]*?\? \['09:00', '14:00'\][\s\S]*?: \['08:30', '13:00'\]/)
  assert.match(source, /monthlyDefaultTimePeriods\(weekly\?\._monthlyTeams\?\.\[month\], month\)/)
  assert.match(source, /periods\.filter\(period => period\.from <= date\)\.at\(-1\)\?\.times/)
  assert.match(source, /!taskHasContent\(task\) && !task\.manualSlot && replacements\[task\.time\]/)
  assert.match(source, /tasks: isSaturday\(date\) \? defaultServiceTasksForDate\(date, weekly\)\.slice\(0, 1\) : defaultServiceTasksForDate\(date, weekly\)/)
  assert.match(source, /const createTeam = \(index, source, day\)[\s\S]*?tasks: defaultServiceTasksForDate\(day, weekly\)/)
})

test('cada equipo reserva una hora mínima y oculta turnos vacíos incompatibles', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/App.jsx'), 'utf8')
  const help = fs.readFileSync(path.resolve(__dirname, '../src/HelpCenter.jsx'), 'utf8')
  assert.match(source, /MINIMUM_SERVICE_GAP_MINUTES = 60/)
  assert.match(source, /Math\.abs\(time - slotTime\) < MINIMUM_SERVICE_GAP_MINUTES/)
  assert.match(source, /tasks: removeUnavailableDefaultSlots\(team\.tasks \|\| \[\]\)/)
  assert.match(source, /minimumServiceGapConflicts\(realServiceTeams\)/)
  assert.match(source, /No se puede reasignar: debe haber al menos una hora/)
  assert.match(help, /menos de 60 minutos de un turno predeterminado todavía vacío/)
})

test('el administrador configura dos horarios predeterminados para cada mes', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/App.jsx'), 'utf8')
  const styles = fs.readFileSync(path.resolve(__dirname, '../src/weekly-enhancements.css'), 'utf8')
  assert.match(source, /Horarios del mes/)
  assert.match(source, /className="modal monthly-times-modal"/)
  assert.match(source, /monthlyTimesSetup\.times\.map\(\(time, index\)/)
  assert.match(source, /Solo un administrador puede definir los horarios mensuales/)
  assert.match(source, /defaultTimes: monthlyTimesSetup\.times, defaultTimePeriods/)
  assert.match(source, /applyMonthlyDefaultTimes\(previous, monthlyTimesSetup\.month, monthlyTimesSetup\.effectiveFrom, monthlyTimesSetup\.times\)/)
  assert.match(source, /key < effectiveFrom/)
  assert.match(source, /Este mes ya terminó\. Sus horarios quedan bloqueados/)
  assert.match(source, /Los cambios regirán desde \$\{prettyDate\(key\)\}/)
  assert.match(source, /Los días anteriores y todos los servicios ya cargados conservarán su horario/)
  assert.match(styles, /\.monthly-time-grid \{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/)
})

test('equipos del mes escala la rotación según técnicos y vehículos', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/App.jsx'), 'utf8')
  const help = fs.readFileSync(path.resolve(__dirname, '../src/HelpCenter.jsx'), 'utf8')
  assert.match(source, /import \{ monthlyTeamRotation \} from '\.\/monthly-team-rotation\.mjs'/)
  assert.match(source, /const rotation = monthlyTeamRotation\(activeTechs, monthKey, '2026-01', vehicles\.length \|\| 3\)/)
  assert.match(source, /const expectedTeamCount = Math\.min\(activeTechs\.length, vehicles\.length \|\| 3\)/)
  assert.match(source, /assignmentsMatchFleet/)
  assert.match(help, /cantidad activa de técnicos y vehículos/)
  assert.match(help, /Ford Ka queda a cargo de un técnico propuesto para salir solo/)
})

test('el administrador configura una rotación anual editable para las guardias de los sábados', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/App.jsx'), 'utf8')
  const styles = fs.readFileSync(path.resolve(__dirname, '../src/weekly-enhancements.css'), 'utf8')
  assert.match(source, /Guardias del año/)
  assert.match(source, /Guardar guardias del año/)
  assert.match(source, /default2026GuardRotationFor/)
  assert.match(source, /assignGuardToEmptySaturday/)
  assert.match(source, /_annualGuards/)
  assert.match(styles, /\.annual-guards-modal/)
  assert.match(styles, /\.annual-guard-row/)
})

test('la agenda semanal permite guardar un día directamente en el historial', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/App.jsx'), 'utf8')
  const styles = fs.readFileSync(path.resolve(__dirname, '../src/ui-polish.css'), 'utf8')
  assert.match(source, /const saveWeeklyDay = day =>/)
  assert.match(source, /const readyTasks = scheduledTasks\.filter\(\(\{ task, team \}\) => weeklyTaskReadyToSave/)
  assert.match(source, /const records = readyTasks\.map/)
  assert.match(source, /servicio\(s\) incompleto\(s\) quedaron sin guardar/)
  assert.match(source, /status: 'Pendiente'/)
  assert.match(source, /Guardado pendiente: guardar agenda/)
  assert.match(source, /dayNeedsSave\(day\)/)
  assert.match(styles, /\.weekly-day-actions \{/)
  assert.match(styles, /\.weekly-day-actions > button \{[\s\S]*?width: 92px;[\s\S]*?height: 40px;[\s\S]*?justify-content: center;/)
})

test('el sábado conserva el identificador del equipo después de guardar', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/App.jsx'), 'utf8')
  assert.match(source, /const storedSaturday = sourceWeekly\?\.\[day\]\?\.teams\?\.\[0\]/)
  assert.match(source, /createTeam\(0, storedSaturday \? \{ teamId: storedSaturday\.teamId \} : null, day\)/)
})

test('el escritorio aprovecha el ancho y el servicio del historial no ocupa dos líneas', () => {
  const styles = fs.readFileSync(path.resolve(__dirname, '../src/ui-polish.css'), 'utf8')
  assert.match(styles, /@media \(min-width: 1200px\)[\s\S]*?max-width: 1640px;/)
  assert.match(styles, /\.history-bulk \.role-chip \{[\s\S]*?text-overflow: ellipsis;[\s\S]*?white-space: nowrap;/)
  assert.match(styles, /minmax\(175px, \.9fr\)/)
})

test('la columna Estado conserva sus óvalos en una sola línea', () => {
  const styles = fs.readFileSync(path.resolve(__dirname, '../src/ui-polish.css'), 'utf8')
  assert.match(styles, /minmax\(120px, \.75fr\) 128px 125px/)
  assert.match(styles, /\.history-bulk \.history-row > div:nth-child\(7\) \.work-status \{[\s\S]*?width: max-content;[\s\S]*?white-space: nowrap;/)
})

test('el historial reduce Fecha y reserva ancho suficiente para Gestionar', () => {
  const styles = fs.readFileSync(path.resolve(__dirname, '../src/ui-polish.css'), 'utf8')
  assert.match(styles, /grid-template-columns: 42px minmax\(128px, \.75fr\)[^;]+128px 125px !important;/)
  assert.match(styles, /@media \(min-width: 1200px\)[\s\S]*?grid-template-columns: 42px minmax\(130px, \.7fr\)[^;]+128px 132px !important;/)
  assert.match(styles, /\.history-bulk \.history-row > div:last-child \{[\s\S]*?padding-right: 14px;[\s\S]*?justify-self: stretch;/)
  assert.match(styles, /\.history-bulk \.history-row > div:last-child > \.detail-button \{[\s\S]*?width: 100%;[\s\S]*?min-inline-size: 0 !important;[\s\S]*?padding-inline: 8px !important;/)
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
  assert.match(source, /<RequiredLabel>Observación<\/RequiredLabel>/)
  assert.match(apiSource, /La observación es obligatoria para informar el servicio/)
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
  const current = { roles, employees: [employee], services: [{ id: 1 }], vehicles: [{ id: 'v1', plate: 'AB123CD' }], customers: [{ account: 'CLI-1' }], history: [{ id: 'old' }], reviews: [], agenda: { date: '2026-01-01', teams: [], weekly: {} } }
  const incoming = { ...current, services: [], vehicles: [], customers: [], history: [], agenda: { date: '2030-01-01', teams: [{ teamId: 'x' }], weekly: {} } }
  const authorized = authorizeIncomingState(incoming, current, user)
  assert.deepEqual(authorized.services, current.services)
  assert.deepEqual(authorized.vehicles, current.vehicles)
  assert.deepEqual(authorized.customers, current.customers)
  assert.deepEqual(authorized.agenda, current.agenda)
})

test('el ABM de vehículos integra estado, permisos, validación y sus cinco campos requeridos', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/App.jsx'), 'utf8')
  const apiCore = fs.readFileSync(path.resolve(__dirname, '../api/_lib/core.cjs'), 'utf8')
  const database = fs.readFileSync(path.resolve(__dirname, '../api/_lib/database.cjs'), 'utf8')
  const icon = fs.readFileSync(path.resolve(__dirname, '../src/components/ui/Icon.jsx'), 'utf8')
  const styles = fs.readFileSync(path.resolve(__dirname, '../src/ui-polish.css'), 'utf8')
  assert.match(source, /\['vehicles', 'Vehículos', 'Administrar la flota de la empresa'\]/)
  assert.match(source, /\['vehicles', 'vehicle', 'Vehículos'\]/)
  assert.match(source, /function Vehicles\(\{ vehicles, setVehicles, setNotice, ask \}\)/)
  for (const label of ['Marca', 'Modelo', 'Año', 'Kilometraje', 'Matrícula']) assert.match(source, new RegExp(`<RequiredLabel>${label}<\\/RequiredLabel>`))
  assert.match(source, /Ya existe un vehículo con esa matrícula/)
  assert.match(apiCore, /unique\(state\.vehicles, 'plate', 'Matrícula'\)/)
  assert.match(apiCore, /el kilometraje no es válido/)
  assert.match(apiCore, /vehicles: userCan\(user, 'vehicles'\)/)
  assert.match(database, /JSON\.stringify\(state\.vehicles \|\| \[\]\)/)
  assert.match(icon, /vehicle:/)
  assert.match(styles, /\.vehicles-table \.table-head,[\s\S]*?\.vehicle-row/)
})

test('normaliza matrícula, año y kilometraje de los vehículos antes de persistir', () => {
  const normalized = normalizeStateForSave({ roles, employees: [], services: [], vehicles: [{ id: 'v1', brand: ' Ford ', model: ' Ranger ', year: '2025', mileage: '125000', plate: ' ab 123 cd ' }], customers: [], history: [], reviews: [], agenda: {} }, { reviews: [] })
  assert.deepEqual(normalized.vehicles, [{ id: 'v1', brand: 'Ford', model: 'Ranger', year: 2025, mileage: 125000, plate: 'AB 123 CD' }])
})

test('conserva el hash al editar un empleado sin cambiar su contraseña', () => {
  const passwordHash = hashPassword('Prueba1234')
  const current = [{ ...employee, passwordHash }]
  const normalized = normalizeStateForSave({ roles, employees: [{ ...employee, lastName: 'Actualizada' }], services: [], customers: [], history: [], reviews: [], agenda: {} }, { reviews: [] })
  const secured = secureEmployees(normalized.employees, current)
  assert.equal(secured[0].passwordHash, passwordHash)
  assert.equal(secured[0].name, 'Ana Actualizada')
})

test('ordena reportes desde la fecha más antigua y por hora dentro del día', () => {
  const records = [
    { id: 'old', date: '2026-01-01', time: '08:00' },
    { id: 'late', date: '2026-01-03', time: '15:00' },
    { id: 'early', date: '2026-01-03', time: '08:00' }
  ].sort(compareReportRecords)
  assert.deepEqual(records.map(record => record.id), ['old', 'early', 'late'])
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

test('el menú móvil cubre las tarjetas de Agenda del día y el acceso directo usa el búho', () => {
  const styles = fs.readFileSync(path.resolve(__dirname, '../src/ui-polish.css'), 'utf8')
  const html = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8')
  const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../public/manifest.webmanifest'), 'utf8'))
  const icon = fs.readFileSync(path.resolve(__dirname, '../public/apple-touch-icon.png'))

  assert.match(styles, /\.app-shell > \.sidebar\.open[\s\S]*z-index: 120 !important/)
  assert.match(styles, /\.app-shell > \.backdrop[\s\S]*z-index: 110 !important/)
  assert.match(html, /rel="apple-touch-icon" href="\/apple-touch-icon\.png"/)
  assert.match(html, /rel="manifest" href="\/manifest\.webmanifest"/)
  assert.equal(manifest.short_name, 'Agenda Pignus')
  assert.ok(manifest.icons.some(item => item.src === '/apple-touch-icon.png'))
  assert.equal(icon.readUInt32BE(16), 180)
  assert.equal(icon.readUInt32BE(20), 180)
})

test('todas las cruces de los modales quedan ancladas arriba a la derecha', () => {
  const styles = fs.readFileSync(path.resolve(__dirname, '../src/ui-polish.css'), 'utf8')
  const closeRule = styles.match(/:is\(\.modal,[^}]+:is\(\.modal-close, \.close-modal\)\s*\{([^}]*)\}/s)?.[1] || ''

  assert.match(closeRule, /position:\s*absolute/)
  assert.match(closeRule, /top:\s*10px/)
  assert.match(closeRule, /right:\s*12px/)
  assert.match(closeRule, /left:\s*auto/)
})

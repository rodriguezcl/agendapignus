import React, { useEffect, useMemo, useRef, useState } from 'react'
import Icon from './components/ui/Icon.jsx'
import './weekly.css'
import './weekly-enhancements.css'
import './ui-polish.css'
import './login.css'

const INITIAL_SERVICES = [
  { id: 1, code: 'alarm-installation', category: 'installation', name: 'Instalación de alarma', description: 'Alta e instalación de sistemas de alarma', status: 'Activo' },
  { id: 2, code: 'service-2', category: 'installation', name: 'Instalación de cámaras', description: 'Instalación de videovigilancia', status: 'Activo' },
  { id: 3, code: 'service-3', category: 'installation', name: 'Instalación de cerco eléctrico', description: 'Instalación de cerco perimetral', status: 'Activo' },
  { id: 4, code: 'service-4', category: 'service', name: 'Service técnico', description: 'Mantenimiento y reparación', status: 'Activo' },
  { id: 5, code: 'service-5', category: 'service', name: 'Visita de relevamiento', description: 'Diagnóstico y presupuesto', status: 'Activo' }
]
// Identificador interno e inmutable del servicio. No depende del cliente, hora ni
// equipo, que pueden cambiar durante la planificación sin crear otro historial.
const createTaskId = () => globalThis.crypto?.randomUUID?.() || `task-${Date.now()}-${Math.random().toString(36).slice(2)}`
const createTeamId = () => globalThis.crypto?.randomUUID?.() || `team-${Date.now()}-${Math.random().toString(36).slice(2)}`
const blankTask = () => ({ taskId: createTaskId(), time: '', serviceId: '', service: '', customerId: '', client: '', clientAccount: '', clientNameAtService: '', address: '', phone: '', detail: '', paymentMethod: '', monthlyFee: '', form: '' })

const moveRecordInWeeklyAgenda = (weekly, record, nextDate) => {
  if (!record?.id || !record?.date || !nextDate) return weekly
  const matchesRecord = task => String(task.historyId || '') === String(record.id) || (record.sourceTaskId && String(task.taskId || '') === String(record.sourceTaskId))
  const removeRecord = day => day?.teams?.length ? { ...day, teams: day.teams.map(team => ({ ...team, tasks: (team.tasks || []).filter(task => !matchesRecord(task)) })) } : day
  const next = { ...(weekly || {}) }
  next[record.date] = removeRecord(next[record.date])
  const destination = removeRecord(next[nextDate]) || { teams: [] }
  const teams = [...(destination.teams || [])]
  const teamNumber = Number(String(record.team || '').match(/\d+/)?.[0]) || 1
  let teamIndex = teams.findIndex(team => record.teamId && String(team.teamId || '') === String(record.teamId))
  if (teamIndex < 0 && !record.teamId && teams[teamNumber - 1]) teamIndex = teamNumber - 1
  if (teamIndex < 0) {
    teamIndex = teams.length
    teams.push({ teamId: record.teamId || createTeamId(), label: record.team || `Equipo ${teamNumber}`, memberIds: record.technicianIds || [], members: record.technicians || [], tasks: [] })
  }
  const task = { taskId: record.sourceTaskId || record.id, historyId: record.id, time: record.time || record.scheduledTime || '', serviceId: record.serviceId || '', service: record.service || '', customerId: record.customerId || '', client: record.client || '', clientAccount: record.clientAccount || record.account || '', clientNameAtService: record.clientNameAtService || '', address: record.address || '', phone: record.phone || '', detail: record.detail || '', installationZone: record.installationZone || '' }
  teams[teamIndex] = { ...teams[teamIndex], teamId: record.teamId || teams[teamIndex].teamId || createTeamId(), memberIds: record.technicianIds?.length ? record.technicianIds : teams[teamIndex].memberIds || [], members: record.technicians?.length ? record.technicians : teams[teamIndex].members || [], tasks: [...(teams[teamIndex].tasks || []), task].sort((a, b) => String(a.time || '').localeCompare(String(b.time || ''))) }
  next[nextDate] = { ...destination, teams }
  return next
}
const blankEmployee = { firstName: '', lastName: '', name: '', roleId: 3, role: 'Técnico', phone: '', email: '', password: '', status: 'Activo' }
const blankCustomer = { customerId: '', kind: 'client', account: '', name: '', type: '', street: '', locality: '', province: '', phone: '', address: '', fields: {} }

// El almacenamiento del navegador es solamente una caché. Un valor antiguo,
// incompleto o malformado nunca debe impedir que la aplicación arranque.
const readLocalValue = (key, fallback = '') => {
  try { return localStorage.getItem(key) ?? fallback }
  catch { return fallback }
}
const readLocalJson = (key, fallback) => {
  try {
    const stored = localStorage.getItem(key)
    return stored == null ? fallback : JSON.parse(stored)
  } catch {
    try { localStorage.removeItem(key) } catch { /* almacenamiento no disponible */ }
    return fallback
  }
}
const writeLocalJson = (key, value) => {
  try { localStorage.setItem(key, JSON.stringify(value)) }
  catch { /* la base de datos sigue siendo la fuente de verdad */ }
}
const writeLocalValue = (key, value) => {
  try { localStorage.setItem(key, String(value)) }
  catch { /* la interfaz puede continuar sin preferencias locales */ }
}

// Dealer/Cuenta is the external system's unique customer identifier. Keeping a
// canonical form prevents duplicated clients when an export changes its casing
// or accidentally includes whitespace around the account code.
const normalizeAccountKey = value => String(value || '').trim().toUpperCase().replace(/\s+/g, '')
const createCustomerId = () => globalThis.crypto?.randomUUID?.() || `customer-${Date.now()}-${Math.random().toString(36).slice(2)}`
const customerKind = customer => customer?.kind === 'subscriber' || String(customer?.account || '').toUpperCase().startsWith('PIG-') ? 'subscriber' : 'client'
const customerKindLabel = customer => customerKind(customer) === 'subscriber' ? 'Abonado' : 'Cliente'
const nextCustomerCode = (customers, kind) => {
  const prefix = kind === 'subscriber' ? 'PIG' : 'CLI'
  const highest = customers.reduce((max, customer) => {
    const match = String(customer.account || '').toUpperCase().match(new RegExp(`^${prefix}-(\\d+)$`))
    return match ? Math.max(max, Number(match[1])) : max
  }, 0)
  return `${prefix}-${String(highest + 1).padStart(4, '0')}`
}
const initialRoles = [
  { id: 1, code: 'administrator', name: 'Administrador', description: 'Acceso completo a la plataforma', permissions: { agenda: true, accounts: true, employees: true, settings: true } },
  { id: 2, code: 'coordinator', name: 'Coordinador', description: 'Gestiona agenda, cuentas y técnicos', permissions: { agenda: true, accounts: true, employees: true, settings: false } },
  { id: 3, code: 'technician', name: 'Técnico', description: 'Consulta su agenda asignada', permissions: { agenda: true, accounts: false, employees: false, settings: false } }
]
// Catálogo único: evita que un módulo quede fuera de la matriz de permisos.
const MODULE_PERMISSIONS = [
  ['dashboard', 'Menú principal', 'Ver indicadores y resumen operativo'],
  ['weekly', 'Agenda semanal', 'Planificar los servicios de toda la semana'],
  ['agenda', 'Agenda del día', 'Crear y editar equipos y servicios'],
  ['history', 'Historial', 'Consultar y gestionar trabajos registrados'],
  ['accounts', 'Abonados y clientes', 'Consultar y administrar abonados y clientes'],
  ['employees', 'Empleados', 'Administrar técnicos y accesos'],
  ['services', 'Tipo de servicio', 'Administrar el catálogo de servicios'],
  ['settings', 'Configuración', 'Modificar roles y permisos'],
  ['audit', 'Auditoría', 'Consultar acciones y accesos del sistema'],
  ['reviews', 'Reseñas', 'Registrar y administrar opiniones de clientes']
]
const DEFAULT_MODULE_PERMISSIONS = Object.fromEntries(MODULE_PERMISSIONS.map(([key]) => [key, false]))

const initialEmployees = [
  { id: 1, firstName: 'Rodrigo', lastName: 'Gonzalez', name: 'Rodrigo Gonzalez', roleId: 3, role: 'Técnico', phone: '11 4567-8901', email: 'rodrigo@pignus.com', password: '••••••••', status: 'Activo' },
  { id: 2, firstName: 'Mariano', lastName: 'Diaz Tillard', name: 'Mariano Diaz Tillard', roleId: 3, role: 'Técnico', phone: '11 3456-2210', email: 'mariano@pignus.com', password: '••••••••', status: 'Activo' },
  { id: 3, firstName: 'Santos', lastName: 'Diaz', name: 'Santos Diaz', roleId: 3, role: 'Técnico', phone: '11 6789-1254', email: 'santos@pignus.com', password: '••••••••', status: 'Activo' }
]

// Versión histórica preservada temporalmente durante la migración a components/ui/Icon.jsx.
function LegacyIcon({ name, size = 18 }) {
  const paths = { menu: 'M3 6h18M3 12h18M3 18h18', calendar: 'M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2', users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m18-8a4 4 0 1 0 0-8m-2 2a4 4 0 1 0-8 0', accounts: 'M4 4h16v16H4zM8 8h8M8 12h8M8 16h5', settings: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm0-13v2m0 15v2m9.5-9.5h-2m-15 0h-2m16.2-6.7-1.4 1.4M6.7 17.3l-1.4 1.4m13.4 0-1.4-1.4M6.7 6.7 5.3 5.3', copy: 'M9 8h10v12H9zM5 16H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1', eye: 'M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6', plus: 'M12 5v14M5 12h14', edit: 'm4 16.5-.5 4 4-.5L19 8.5l-3.5-3.5L4 16.5ZM13.5 7l3.5 3.5', trash: 'M4 7h16m-10 4v6m4-6v6M9 7l1-3h4l1 3m-9 0 1 14h10l1-14', upload: 'M12 16V3m0 0L7 8m5-5 5 5M4 14v5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5', search: 'm21 21-4.5-4.5m2-5a7 7 0 1 1-14 0 7 7 0 0 1 14 0', moon: 'M20 15.5A8.5 8.5 0 0 1 8.5 4 8.5 8.5 0 1 0 20 15.5Z', sun: 'M12 3v2m0 14v2M3 12h2m14 0h2m-3.6-5.4 1.4-1.4M5.2 18.8l1.4-1.4m0-10.8L5.2 5.2m13.6 13.6-1.4-1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0', close: 'M6 6l12 12M18 6 6 18', check: 'm5 12 4 4L19 6', lock: 'M6 10V7a6 6 0 0 1 12 0v3M5 10h14v11H5z' }
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] || paths.settings} /></svg>
}
const initials = name => name.split(' ').map(x => x[0]).slice(0, 2).join('').toUpperCase()
const normalizeRoleName = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()
const roleCode = role => role?.code || ({ administrador: 'administrator', tecnico: 'technician', coordinador: 'coordinator', usuario: 'user' }[normalizeRoleName(role?.name)] || `role-${role?.id}`)
const normalizeServiceName = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()
// Las búsquedas operativas no dependen de tildes, mayúsculas, espacios ni
// signos. "instalacion", "Instalación" y "INSTALACION" son equivalentes.
const normalizeSearchText = value => String(value ?? '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLocaleLowerCase('es')
  .replace(/[^a-z0-9]/g, '')
const serviceCode = service => service?.code || (normalizeServiceName(service?.name) === 'instalacion de alarma' ? 'alarm-installation' : `service-${service?.id}`)
const prettyDate = value => value ? new Date(`${value}T12:00:00`).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).replace(/^./, x => x.toUpperCase()) : ''
// Cada familia de trabajo tiene un color consistente en el historial para facilitar su lectura.
const serviceColorClass = service => {
  const normalized = String(service || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  if (normalized.includes('retiro')) return 'service-retirement'
  if (normalized.includes('titularidad')) return 'service-ownership'
  if (normalized.includes('camara')) return 'service-cameras'
  if (normalized.includes('cerco')) return 'service-fence'
  if (normalized.includes('alarma')) return 'service-alarm'
  if (normalized.includes('relevamiento')) return 'service-survey'
  if (normalized.includes('ampliacion') || normalized.includes('mejora')) return 'service-upgrade'
  return 'service-other'
}
// Unifica el horario operativo en Argentina aunque el servidor guarde fechas en UTC.
const prettyReportDateTime = value => value ? `${new Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: 'numeric', month: 'numeric', year: 'numeric' }).format(new Date(value))}, ${new Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(value))} Hs` : ''
function showAgendaValidationModal(missing) {
  document.getElementById('agenda-validation-modal')?.remove()
  const layer = document.createElement('div'); layer.id = 'agenda-validation-modal'; layer.className = 'modal-layer'
  const modal = document.createElement('div'); modal.className = 'modal confirm-modal validation-modal'
  const icon = document.createElement('span'); icon.className = 'confirm-icon danger'; icon.textContent = '!'
  const title = document.createElement('h2'); title.textContent = 'Completá los campos obligatorios'
  const detail = document.createElement('p'); detail.textContent = 'Antes de guardar o copiar la agenda, revisá los siguientes servicios:'
  const list = document.createElement('ul'); list.className = 'validation-list'
  missing.forEach(item => { const entry = document.createElement('li'); entry.textContent = item; list.append(entry) })
  const actions = document.createElement('div'); actions.className = 'confirm-actions'
  const close = document.createElement('button'); close.className = 'primary'; close.type = 'button'; close.textContent = 'Entendido'; close.onclick = () => layer.remove()
  actions.append(close); modal.append(icon, title, detail, list, actions); layer.append(modal)
  layer.addEventListener('click', event => { if (event.target === layer) layer.remove() })
  document.body.append(layer)
}

// Advertencia previa: permite detectar equipos sin técnicos antes de guardar o copiar.
function showMissingTechniciansModal(teamNumbers, onContinue) {
  document.getElementById('agenda-technicians-modal')?.remove()
  const layer = document.createElement('div'); layer.id = 'agenda-technicians-modal'; layer.className = 'modal-layer'
  const modal = document.createElement('div'); modal.className = 'modal confirm-modal validation-modal'
  const icon = document.createElement('span'); icon.className = 'confirm-icon danger'; icon.textContent = '!'
  const title = document.createElement('h2'); title.textContent = 'Técnicos sin asignar'
  const detail = document.createElement('p'); detail.textContent = `La asignación de al menos un técnico es obligatoria. ${teamNumbers.join(', ')} no tiene técnicos asignados.`
  const note = document.createElement('p'); note.className = 'modal-helper'; note.textContent = 'Podés volver para asignarlos o continuar excepcionalmente bajo tu responsabilidad.'
  const actions = document.createElement('div'); actions.className = 'confirm-actions'
  const cancel = document.createElement('button'); cancel.className = 'secondary'; cancel.type = 'button'; cancel.textContent = 'Volver y asignar'; cancel.onclick = () => layer.remove()
  actions.append(cancel); modal.append(icon, title, detail, note, actions); layer.append(modal)
  layer.addEventListener('click', event => { if (event.target === layer) layer.remove() })
  document.body.append(layer)
}

// Evita asignaciones dobles accidentales, sin impedir los casos operativos en que sí son necesarias.
function showDuplicateTechniciansModal(duplicates, availableTechnicians, onCorrect, onContinue) {
  document.getElementById('agenda-duplicates-modal')?.remove()
  const layer = document.createElement('div'); layer.id = 'agenda-duplicates-modal'; layer.className = 'modal-layer'
  const modal = document.createElement('div'); modal.className = 'modal confirm-modal validation-modal duplicate-technicians-modal'
  const icon = document.createElement('span'); icon.className = 'confirm-icon danger'; icon.textContent = '!'
  const title = document.createElement('h2'); title.textContent = 'Técnicos asignados en más de un equipo'
  const detail = document.createElement('p'); detail.textContent = duplicates.map(item => `${item.name}: ${item.teams.map(team => `Equipo ${team + 1}`).join(' y ')}`).join('. ')
  const helper = document.createElement('p'); helper.className = 'modal-helper'; helper.textContent = availableTechnicians.length ? 'Podés reemplazar las asignaciones repetidas por técnicos aún disponibles.' : 'No hay técnicos disponibles para reemplazar las asignaciones repetidas.'
  const replacements = []
  if (availableTechnicians.length) duplicates.forEach(item => item.teams.slice(1).forEach(teamIndex => {
    const field = document.createElement('label'); field.textContent = `Reemplazar a ${item.name} en Equipo ${teamIndex + 1}`
    const select = document.createElement('select')
    const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = 'Seleccionar técnico'; select.append(placeholder)
    availableTechnicians.forEach(name => { const option = document.createElement('option'); option.value = name; option.textContent = name; select.append(option) })
    field.append(select); modal.append(field)
    replacements.push({ teamIndex, name: item.name, select })
  }))
  const actions = document.createElement('div'); actions.className = 'confirm-actions'
  const correct = document.createElement('button'); correct.className = 'secondary'; correct.type = 'button'; correct.textContent = 'Corregir asignación'; correct.disabled = !availableTechnicians.length
  correct.onclick = () => { const changes = replacements.filter(item => item.select.value).map(item => ({ teamIndex: item.teamIndex, name: item.name, replacement: item.select.value })); if (!changes.length) return; layer.remove(); onCorrect(changes) }
  const proceed = document.createElement('button'); proceed.className = 'primary'; proceed.type = 'button'; proceed.textContent = 'Continuar de todos modos'; proceed.onclick = () => { layer.remove(); onContinue() }
  // Sin técnicos disponibles, el botón permite volver a la agenda para corregir manualmente.
  correct.disabled = false
  correct.onclick = () => {
    if (!availableTechnicians.length) { layer.remove(); return }
    const changes = replacements.filter(item => item.select.value).map(item => ({ teamIndex: item.teamIndex, name: item.name, replacement: item.select.value }))
    if (!changes.length) return
    layer.remove(); onCorrect(changes)
  }
  actions.append(correct, proceed); modal.append(icon, title, detail, helper, actions); layer.append(modal)
  layer.addEventListener('click', event => { if (event.target === layer) layer.remove() })
  document.body.append(layer)
}

/** Pantalla aislada de autenticación; la contraseña sólo viaja al endpoint de acceso. */
function Login({ onLogin }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const submit = async event => {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'No se pudo iniciar sesión.')
      setPassword('')
      onLogin(data.user)
    } catch (loginError) { setError(loginError.message) }
    finally { setSubmitting(false) }
  }
  return <main className="login-page"><form className="login-card" onSubmit={submit}><img src="/logo-pignus.png" alt="Pignus" /><p className="eyebrow">ACCESO SEGURO</p><h1>Ingresá a Agenda técnica</h1><p>Usá el correo y la contraseña definidos en el módulo Empleados.</p><label>Correo electrónico<input required autoComplete="username" type="email" value={email} onChange={event => setEmail(event.target.value)} /></label><label htmlFor="login-password">Contraseña</label><div className="password-field"><input id="login-password" aria-label="Contraseña" required autoComplete="current-password" minLength="8" type={showPassword ? 'text' : 'password'} value={password} onChange={event => setPassword(event.target.value)} /><button type="button" className="password-visibility" aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'} aria-pressed={showPassword} onClick={() => setShowPassword(value => !value)}><Icon name="eye" size={17} /><span>{showPassword ? 'Ocultar' : 'Mostrar'}</span></button></div>{error && <p className="login-error" role="alert">{error}</p>}<button className="primary" disabled={submitting}>{submitting ? 'Verificando acceso...' : 'Iniciar sesión'}</button><small>El acceso se cierra automáticamente al finalizar la sesión.</small></form></main>
}

export default function App() {
  const [module, setModule] = useState('dashboard')
  const [menuOpen, setMenuOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => readLocalValue('pignus-sidebar-collapsed') === 'true')
  const [theme, setTheme] = useState(() => readLocalValue('pignus-theme', 'light'))
  const [roles, setRoles] = useState(() => readLocalJson('pignus-roles', null) || initialRoles)
  const [employees, setEmployees] = useState(() => readLocalJson('pignus-employees', null) || initialEmployees)
  const [services, setServices] = useState(() => readLocalJson('pignus-services', null) || INITIAL_SERVICES)
  const [history, setHistory] = useState(() => readLocalJson('pignus-history', []))
  const [customers, setCustomers] = useState(() => readLocalJson('pignus-customers', []))
  const [reviews, setReviews] = useState(() => readLocalJson('pignus-reviews', []))
  const [teams, setTeams] = useState(() => readLocalJson('pignus-agenda', null)?.teams || [{ teamId: createTeamId(), memberIds: [], members: [], tasks: [blankTask()] }])
  const [date, setDate] = useState(() => readLocalJson('pignus-agenda', null)?.date || new Date().toISOString().slice(0, 10))
  const [weekly, setWeekly] = useState(() => readLocalJson('pignus-agenda', null)?.weekly || {})
  const [notice, setNotice] = useState('')
  const [confirmation, setConfirmation] = useState(null)
  const [databaseReady, setDatabaseReady] = useState(false)
  const [stateRevision, setStateRevision] = useState(null)
  const pendingStateSaves = useRef(0)
  const [authUser, setAuthUser] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [profileOpen, setProfileOpen] = useState(false)
  useEffect(() => writeLocalValue('pignus-theme', theme), [theme])
  useEffect(() => writeLocalValue('pignus-sidebar-collapsed', sidebarCollapsed), [sidebarCollapsed])
  useEffect(() => writeLocalJson('pignus-roles', roles), [roles])
  useEffect(() => writeLocalJson('pignus-employees', employees), [employees])
  useEffect(() => writeLocalJson('pignus-services', services), [services])
  useEffect(() => writeLocalJson('pignus-history', history), [history])
  useEffect(() => writeLocalJson('pignus-customers', customers), [customers])
  useEffect(() => writeLocalJson('pignus-reviews', reviews), [reviews])
  useEffect(() => writeLocalJson('pignus-agenda', { date, teams, weekly }), [date, teams, weekly])
  useEffect(() => {
    if (!services.length) return
    const normalizeReference = item => {
      const matched = services.find(service => String(service.id) === String(item.serviceId)) || services.find(service => normalizeServiceName(service.name) === normalizeServiceName(item.service))
      return matched && (String(item.serviceId) !== String(matched.id) || item.service !== matched.name) ? { ...item, serviceId: matched.id, service: matched.name } : item
    }
    const normalizeTeams = value => (value || []).map(team => ({ ...team, tasks: (team.tasks || []).map(normalizeReference) }))
    setTeams(previous => { const next = normalizeTeams(previous); return JSON.stringify(next) === JSON.stringify(previous) ? previous : next })
    setWeekly(previous => { const next = Object.fromEntries(Object.entries(previous || {}).map(([key, value]) => [key, key.startsWith('_') ? value : { ...value, teams: normalizeTeams(value?.teams) }])); return JSON.stringify(next) === JSON.stringify(previous) ? previous : next })
    setHistory(previous => { const next = previous.map(normalizeReference); return JSON.stringify(next) === JSON.stringify(previous) ? previous : next })
  }, [services])
  useEffect(() => {
    if (!customers.length) return
    const normalizedCustomers = customers.map(customer => ({ ...customer, customerId: customer.customerId || createCustomerId(), kind: customerKind(customer) }))
    if (normalizedCustomers.some((customer, index) => JSON.stringify(customer) !== JSON.stringify(customers[index]))) {
      setCustomers(normalizedCustomers)
      return
    }
    const byId = new Map(normalizedCustomers.map(customer => [String(customer.customerId), customer]))
    const byAccount = new Map(normalizedCustomers.map(customer => [normalizeAccountKey(customer.account), customer]))
    const normalizeReference = item => {
      const matched = byId.get(String(item.customerId || '')) || byAccount.get(normalizeAccountKey(item.clientAccount))
      return matched && (String(item.customerId) !== String(matched.customerId) || item.clientAccount !== matched.account)
        ? { ...item, customerId: matched.customerId, clientAccount: matched.account }
        : item
    }
    const normalizeTeams = value => (value || []).map(team => ({ ...team, tasks: (team.tasks || []).map(normalizeReference) }))
    setTeams(previous => { const next = normalizeTeams(previous); return JSON.stringify(next) === JSON.stringify(previous) ? previous : next })
    setWeekly(previous => { const next = Object.fromEntries(Object.entries(previous || {}).map(([key, value]) => [key, key.startsWith('_') ? value : { ...value, teams: normalizeTeams(value?.teams) }])); return JSON.stringify(next) === JSON.stringify(previous) ? previous : next })
    setHistory(previous => { const next = previous.map(normalizeReference); return JSON.stringify(next) === JSON.stringify(previous) ? previous : next })
  }, [customers])
  useEffect(() => {
    if (!employees.length) return
    const byId = new Map(employees.map(employee => [String(employee.id), employee]))
    const byName = new Map(employees.map(employee => [normalizeServiceName(employee.name), employee]))
    const normalizeAssignments = item => {
      const assigned = [...new Map([...(item.memberIds || item.technicianIds || []).map(id => byId.get(String(id))), ...(item.members || item.technicians || []).map(name => byName.get(normalizeServiceName(name)))].filter(Boolean).map(employee => [String(employee.id), employee])).values()]
      if ('tasks' in item) return { ...item, teamId: item.teamId || createTeamId(), memberIds: assigned.map(employee => employee.id), members: assigned.map(employee => employee.name) }
      return { ...item, technicianIds: assigned.map(employee => employee.id), technicians: assigned.map(employee => employee.name) }
    }
    const normalizeTeams = teams => (teams || []).map(normalizeAssignments)
    setTeams(previous => { const next = normalizeTeams(previous); return JSON.stringify(next) === JSON.stringify(previous) ? previous : next })
    setWeekly(previous => { const next = Object.fromEntries(Object.entries(previous || {}).map(([key, value]) => key === '_monthlyTeams' ? [key, Object.fromEntries(Object.entries(value || {}).map(([month, config]) => [month, { ...config, teams: normalizeTeams(config?.teams) }]))] : [key, key.startsWith('_') ? value : { ...value, teams: normalizeTeams(value?.teams) }])); return JSON.stringify(next) === JSON.stringify(previous) ? previous : next })
    setHistory(previous => { const next = previous.map(normalizeAssignments); return JSON.stringify(next) === JSON.stringify(previous) ? previous : next })
  }, [employees])
  useEffect(() => {
    fetch('/api/auth/session').then(response => response.ok ? response.json() : null).then(data => setAuthUser(data?.user || null)).catch(() => setAuthUser(null)).finally(() => setAuthLoading(false))
  }, [])
  useEffect(() => {
    const brand = document.querySelector('.brand')
    const goToDashboard = () => setModule('dashboard')
    brand?.addEventListener('click', goToDashboard)
    return () => brand?.removeEventListener('click', goToDashboard)
  }, [])
  useEffect(() => {
    // El menú compacto conserva los accesos por icono y libera espacio de trabajo.
    const shell = document.querySelector('.app-shell')
    const sidebar = shell?.querySelector('.sidebar')
    if (!shell || !sidebar) return undefined
    shell.classList.toggle('sidebar-collapsed', sidebarCollapsed)
    sidebar.classList.toggle('sidebar-compact', sidebarCollapsed)
    const control = document.createElement('button')
    control.type = 'button'
    control.className = `sidebar-collapse-toggle ${sidebarCollapsed ? 'is-collapsed' : ''}`
    // Estilos críticos en línea: el control no depende del orden de las hojas de estilo.
    Object.assign(control.style, {
      position: 'absolute', top: '16px', left: '100%', transform: 'translateX(-50%)',
      zIndex: '20', display: 'grid', placeItems: 'center', width: '34px', height: '34px',
      padding: '0', border: '1px solid #54705e', borderRadius: '50%', background: '#1b412d',
      color: '#fff', fontSize: '22px', lineHeight: '1', boxShadow: '0 3px 9px rgba(5, 26, 14, .25)'
    })
    control.setAttribute('aria-label', sidebarCollapsed ? 'Expandir menú lateral' : 'Contraer menú lateral')
    control.title = sidebarCollapsed ? 'Expandir menú lateral' : 'Contraer menú lateral'
    control.textContent = sidebarCollapsed ? '›' : '‹'
    const toggle = event => { event.preventDefault(); event.stopPropagation(); setSidebarCollapsed(value => !value) }
    control.addEventListener('click', toggle)
    sidebar.querySelectorAll('nav button').forEach(button => { button.title = button.textContent.trim() })
    // Se ubica dentro de la barra: así se mantiene alineado con su borde al cambiar el ancho.
    sidebar.append(control)
    return () => { control.removeEventListener('click', toggle); control.remove() }
  })
  useEffect(() => {
    const goToHistory = () => setModule('history')
    window.addEventListener('pignus:open-history', goToHistory)
    return () => window.removeEventListener('pignus:open-history', goToHistory)
  }, [])
  useEffect(() => {
    // Los mensajes que confirman operaciones de agenda no deben ocupar otros módulos.
    const noticeElement = document.querySelector('.content > .notice')
    const isAgendaMessage = notice.startsWith('La agenda ')
    noticeElement?.classList.toggle('agenda-message-hidden', isAgendaMessage && module !== 'agenda')
  }, [module, notice])
  useEffect(() => {
    // Mantiene sincronizada la agenda abierta cuando se corrige un servicio desde Historial.
    const syncAgendaService = event => {
      const { record, patch } = event.detail || {}
      if (!record || !patch) return
      const legacyTeamIndex = Number(String(record.team || '').match(/\d+/)?.[0]) - 1
      setTeams(previous => previous.map((team, index) => (record.teamId ? String(team.teamId) !== String(record.teamId) : index !== legacyTeamIndex) ? team : {
        ...team,
        memberIds: patch.technicianIds || team.memberIds,
        members: patch.technicians || team.members,
        tasks: team.tasks.map(task => {
          const sameTask = record.sourceTaskId ? String(task.taskId) === String(record.sourceTaskId) : task.historyId ? String(task.historyId) === String(record.id) : task.client === record.client && task.service === record.service
          return sameTask ? { ...task, customerId: patch.customerId ?? task.customerId, clientAccount: patch.clientAccount ?? task.clientAccount, client: patch.client ?? task.client, serviceId: patch.serviceId ?? task.serviceId, service: patch.service ?? task.service, address: patch.address ?? task.address, phone: patch.phone ?? task.phone, detail: patch.detail ?? task.detail } : task
        })
      }))
    }
    window.addEventListener('pignus:sync-agenda-service', syncAgendaService)
    return () => window.removeEventListener('pignus:sync-agenda-service', syncAgendaService)
  }, [])
  useEffect(() => {
    const moveWeeklyService = event => {
      const { record, nextDate } = event.detail || {}
      if (!record || !nextDate) return
      setWeekly(previous => moveRecordInWeeklyAgenda(previous, record, nextDate))
    }
    window.addEventListener('pignus:reschedule-service', moveWeeklyService)
    return () => window.removeEventListener('pignus:reschedule-service', moveWeeklyService)
  }, [])
  useEffect(() => {
    if (!authUser) return
    fetch('/api/state').then(response => response.ok ? response.json() : Promise.reject()).then(data => {
      setStateRevision(Number(data.revision || 0))
      if (data.roles?.length) setRoles(data.roles.map(role => { const code = roleCode(role); return { ...role, code, permissions: { ...DEFAULT_MODULE_PERMISSIONS, dashboard: true, weekly: role.permissions?.weekly ?? ['administrator', 'user', 'coordinator'].includes(code), ...role.permissions, ...(code === 'administrator' ? Object.fromEntries(MODULE_PERMISSIONS.map(([key]) => [key, true])) : {}) } } }))
      if (data.employees?.length) setEmployees(data.employees.map(employee => { const assignedRole = data.roles?.find(role => String(role.id) === String(employee.roleId)) || data.roles?.find(role => normalizeRoleName(role.name) === normalizeRoleName(employee.role)); return assignedRole ? { ...employee, roleId: assignedRole.id, role: assignedRole.name } : employee }))
      if (data.services?.length) setServices(data.services.map(service => ({ ...service, code: serviceCode(service), category: service.category || (normalizeServiceName(service.name).startsWith('instalacion') ? 'installation' : 'service') })))
      if (Array.isArray(data.history)) setHistory(data.history)
      if (data.customers?.length) setCustomers(data.customers.map(customer => ({ ...customer, customerId: customer.customerId || createCustomerId(), kind: customerKind(customer) })))
      if (Array.isArray(data.reviews)) setReviews(data.reviews)
      if (data.agenda?.teams?.length) { setTeams(data.agenda.teams); setDate(data.agenda.date || date) }
      if (data.agenda?.weekly && typeof data.agenda.weekly === 'object') setWeekly(data.agenda.weekly)
      if (data.preferences?.theme) setTheme(data.preferences.theme)
    }).catch(() => setNotice('No se pudo conectar con la base de datos local.')).finally(() => setDatabaseReady(true))
  }, [authUser])
  useEffect(() => {
    if (!databaseReady || stateRevision === null || !authUser || authUser.roleCode === 'technician' || (!authUser.roleCode && normalizeRoleName(authUser.role) === 'tecnico')) return
    const timer = setTimeout(() => {
      pendingStateSaves.current += 1
      fetch('/api/state', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revision: stateRevision, roles, employees, services, history, customers, reviews, agenda: { date, teams, weekly }, preferences: { theme } })
      }).then(async response => {
        if (response.ok) { const payload = await response.json(); setStateRevision(Number(payload.revision)); return }
        const payload = await response.json().catch(() => ({}))
        throw new Error(payload.error || 'No se pudieron guardar los últimos cambios.')
      }).catch(error => setNotice(error.message || 'No se pudieron guardar los últimos cambios.'))
        .finally(() => { pendingStateSaves.current = Math.max(0, pendingStateSaves.current - 1) })
    }, 750)
    return () => clearTimeout(timer)
  }, [databaseReady, authUser, roles, employees, services, history, customers, reviews, date, teams, weekly, theme])
  useEffect(() => {
    // Sincronización ligera del tablero semanal. Evita recargar la página y no pisa
    // un campo que el usuario está editando en ese momento.
    if (!databaseReady || !authUser) return undefined
    const refreshWeekly = () => {
      // Un PUT de esta misma pestaña aumenta la revisión del servidor antes de
      // que React alcance a actualizar stateRevision. No debe tratarse como un
      // cambio externo durante esa pequeña ventana.
      if (pendingStateSaves.current > 0) return
      if (document.activeElement?.closest('.weekly-board input, .weekly-board select, .weekly-board textarea')) return
      fetch('/api/state', { cache: 'no-store' }).then(response => response.ok ? response.json() : null).then(data => {
        if (data && Number(data.revision) !== Number(stateRevision)) { setNotice('Hay cambios guardados desde otra sesión. Recargá la página para continuar sin sobrescribirlos.'); return }
        if (data?.agenda?.weekly && typeof data.agenda.weekly === 'object') setWeekly(previous => JSON.stringify(previous) === JSON.stringify(data.agenda.weekly) ? previous : data.agenda.weekly)
      }).catch(() => setNotice('No se pudo comprobar si existen cambios de otra sesión.'))
    }
    const timer = window.setInterval(refreshWeekly, 4000)
    window.addEventListener('focus', refreshWeekly)
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refreshWeekly) }
  }, [databaseReady, authUser, stateRevision])
  const ask = (title, detail, action, destructive = false) => setConfirmation({ title, detail, action, destructive })
  const updateTask = (team, task, patch) => setTeams(prev => prev.map((t, ti) => ti !== team ? t : { ...t, tasks: t.tasks.map((x, i) => i !== task ? x : { ...x, ...patch }) }))
  const employeeRole = employee => roles.find(role => String(role.id) === String(employee.roleId)) || roles.find(role => normalizeRoleName(role.name) === normalizeRoleName(employee.role))
  // La capacidad técnica depende del código estable, no del nombre editable.
  const activeTechs = employees.filter(employee => employee.status === 'Activo' && roleCode(employeeRole(employee)) === 'technician')
  const isAdministrator = authUser?.roleCode === 'administrator' || (!authUser?.roleCode && normalizeRoleName(authUser?.role) === 'administrador')
  // Cada módulo tiene un ícono propio para facilitar el reconocimiento visual en la navegación.
  const nav = [['dashboard', 'dashboard', 'Menú principal'], ['weekly', 'calendar', 'Agenda semanal'], ['agenda', 'agenda', 'Agenda del día'], ['history', 'history', 'Historial'], ['accounts', 'accounts', 'Abonados y clientes'], ['employees', 'users', 'Empleados'], ['services', 'tools', 'Tipo de servicio'], ['settings', 'settings', 'Configuración']]
  const activeRole = roles.find(role => String(role.id) === String(authUser?.roleId)) || roles.find(role => role.name === authUser?.role)
  const modulePermissions = { ...DEFAULT_MODULE_PERMISSIONS, dashboard: true, ...activeRole?.permissions }
  if (!isAdministrator) {
    for (let index = nav.length - 1; index >= 0; index -= 1) if (!modulePermissions[nav[index][0]]) nav.splice(index, 1)
  }
  useEffect(() => {
    if (!isAdministrator && !modulePermissions[module] && nav[0]) setModule(nav[0][0])
  }, [isAdministrator, module, activeRole?.id])
  const title = { dashboard: 'Menú principal', weekly: 'Agenda semanal', agenda: 'Agenda del día', history: 'Historial', accounts: 'Abonados y clientes', employees: 'Empleados', services: 'Tipo de servicio', settings: 'Configuración', audit: 'Auditoría', reviews: 'Reseñas' }[module]
  useEffect(() => {
    document.title = authUser ? `${title || 'Agenda técnica'} | PIGNUS` : 'Ingresar | PIGNUS'
  }, [title, authUser])
  if (isAdministrator) nav.push(['audit', 'audit', 'Auditoría'], ['reviews', 'reviews', 'Reseñas'])
  const emptyAgenda = () => ({ date: new Date().toISOString().slice(0, 10), teams: [{ teamId: createTeamId(), memberIds: [], members: [], tasks: [blankTask()] }] })
  // Una agenda se considera pendiente cuando tiene datos que todavía no quedaron registrados en Historial.
  const hasUnsavedAgenda = teams.some((team, teamIndex) => {
    const membersChanged = team.members.length > 0 && !history.some(record => record.date === date && record.team === `Equipo ${teamIndex + 1}` && JSON.stringify(record.technicians || []) === JSON.stringify(team.members))
    const hasPendingTask = team.tasks.some(task => Object.values(task).some(Boolean) && !history.some(record => record.date === date && record.team === `Equipo ${teamIndex + 1}` && record.time === task.time && record.service === task.service && record.client === task.client && record.address === task.address && record.phone === task.phone && record.detail === task.detail))
    return membersChanged || hasPendingTask
  })
  const logout = async () => {
    // La agenda temporal no debe permanecer disponible para la próxima sesión.
    if (authUser?.role?.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase() !== 'tecnico') {
      if (databaseReady) {
        try {
          const response = await fetch('/api/agenda/daily/clear', { method: 'POST' })
          const payload = await response.json().catch(() => ({}))
          if (!response.ok) throw new Error(payload.error || 'No se pudo limpiar la agenda del día.')
          setStateRevision(Number(payload.revision))
        } catch (error) { setNotice(error.message); return }
      }
      const clean = emptyAgenda()
      setTeams(clean.teams); setDate(clean.date); localStorage.removeItem('pignus-agenda')
    }
    await fetch('/api/auth/logout', { method: 'POST' }); setAuthUser(null); setDatabaseReady(false); setStateRevision(null); setModule('dashboard')
  }
  const requestLogout = () => setConfirmation(hasUnsavedAgenda
    ? { title: 'Agenda sin guardar', detail: 'Hay servicios cargados que aún no fueron guardados en el historial. Si cerrás sesión, la agenda se limpiará y esos datos se perderán.', action: logout, destructive: true, confirmLabel: 'Cerrar sesión y descartar agenda' }
    : { title: 'Cerrar sesión', detail: '¿Querés cerrar sesión? La agenda se limpiará para dejar el sistema listo para una nueva sesión.', action: logout, confirmLabel: 'Sí, cerrar sesión' })
  useEffect(() => {
    // Intercepta el botón común del encabezado para aplicar la verificación de agenda antes de salir.
    const button = document.querySelector('.topbar .logout-button')
    if (!button) return undefined
    const intercept = event => { event.preventDefault(); event.stopPropagation(); requestLogout() }
    button.addEventListener('click', intercept, true)
    return () => button.removeEventListener('click', intercept, true)
  })
  if (authLoading) return <main className="login-page"><div className="login-loading">Verificando sesión segura…</div></main>
  if (!authUser) return <Login onLogin={setAuthUser} />
  if (authUser.role?.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase() === 'tecnico') return <TechnicianPortal user={authUser} history={history} setHistory={setHistory} logout={logout} />
  if (module === 'audit' && isAdministrator) return <AuditShell user={authUser} onNavigate={setModule} logout={logout} />
  return <div className="app-shell" data-theme={theme}><aside className={`sidebar ${menuOpen ? 'open' : ''}`}><div className="brand"><span className="brand-mark">◢</span><div><strong>PIGNUS</strong><small>GUARDIANES POR NATURALEZA</small></div></div><p className="nav-label">MÓDULOS</p><nav>{nav.map(([id, icon, label]) => <button key={id} onClick={() => { setModule(id); setMenuOpen(false) }} className={module === id ? 'active' : ''}><Icon name={icon} />{label}</button>)}</nav><div className="sidebar-bottom">v1.1 · Agenda técnica</div></aside>{menuOpen && <button className="backdrop" aria-label="Cerrar menú" onClick={() => setMenuOpen(false)} />}<main><header className="topbar"><button className="mobile-menu" onClick={() => setMenuOpen(true)}><Icon name="menu" /></button><div className="page-heading"><span>PIGNUS</span><i></i><b>{title}</b></div><div className="profile"><button className="theme-toggle" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}><Icon name={theme === 'light' ? 'moon' : 'sun'} /></button><div className="profile-menu"><button className="profile-trigger" onClick={() => setProfileOpen(open => !open)} aria-expanded={profileOpen}><span className="profile-avatar">{initials(authUser.name)}</span><span>{authUser.name}</span></button>{profileOpen && <div className="profile-popover"><b>{authUser.name}</b><span>{authUser.email}</span><small>{authUser.role}</small></div>}</div><button className="logout-button" onClick={() => setConfirmation({ title: 'Cerrar sesión', detail: '¿Querés cerrar sesión? Tendrás que volver a ingresar con tus credenciales para acceder al sistema.', action: logout, confirmLabel: 'Sí, cerrar sesión' })} title="Cerrar sesión"><Icon name="logout" size={17} /><span>Cerrar sesión</span></button></div></header><section className="content">{notice && <div className="notice"><span><Icon name="check" size={16} />{notice}</span><button onClick={() => setNotice('')}><Icon name="close" size={16} /></button></div>}{module === 'dashboard' && <Dashboard history={history} services={services} />}{module === 'weekly' && <WeeklyPlanner weekly={weekly} setWeekly={setWeekly} customers={customers} services={services} activeTechs={activeTechs} setNotice={setNotice} openDaily={(nextDate, nextTeams) => { setDate(nextDate); setTeams(nextTeams); setModule('agenda') }} />}{module === 'agenda' && <Agenda {...{ date, setDate, teams, setTeams, activeTechs, customers, services, history, setHistory, updateTask, setNotice, weekly, setWeekly }} />}{module === 'history' && <History history={history} setHistory={setHistory} customers={customers} services={services} employees={employees} />}{module === 'reviews' && <Reviews reviews={reviews} setReviews={setReviews} customers={customers} setNotice={setNotice} ask={ask} />}{module === 'accounts' && <Accounts {...{ customers, setCustomers, setNotice, ask, history, teams, weekly, reviews }} />}{module === 'employees' && <Employees {...{ employees, setEmployees, roles, setNotice, ask, history, teams, weekly }} />}{module === 'services' && <ServiceTypes {...{ services, setServices, setNotice, ask, history, teams, weekly }} />}{module === 'settings' && <Settings {...{ roles, setRoles, setNotice, ask, employees }} />}</section></main>{confirmation && <Confirm {...confirmation} close={() => setConfirmation(null)} />}</div>
  return <div className="app-shell" data-theme={theme}><aside className={`sidebar ${menuOpen ? 'open' : ''}`}><div className="brand"><span className="brand-mark">◢</span><div><strong>PIGNUS</strong><small>GUARDIANES POR NATURALEZA</small></div></div><p className="nav-label">MÓDULOS</p><nav>{nav.map(([id, icon, label]) => <button key={id} onClick={() => { setModule(id); setMenuOpen(false) }} className={module === id ? 'active' : ''}><Icon name={icon} />{label}</button>)}</nav><div className="sidebar-bottom">v1.1 · Agenda técnica</div></aside>{menuOpen && <button className="backdrop" aria-label="Cerrar menú" onClick={() => setMenuOpen(false)} />}<main><header className="topbar"><button className="mobile-menu" onClick={() => setMenuOpen(true)}><Icon name="menu" /></button><div className="page-heading"><span>PIGNUS</span><i></i><b>{title}</b></div><div className="profile"><button className="theme-toggle" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}><Icon name={theme === 'light' ? 'moon' : 'sun'} /></button><span className="profile-avatar">LR</span><span>Leonardo Rodríguez</span></div></header><section className="content">{notice && <div className="notice"><span><Icon name="check" size={16} />{notice}</span><button onClick={() => setNotice('')}><Icon name="close" size={16} /></button></div>}{module === 'dashboard' && <Dashboard history={history} services={services} />}{module === 'agenda' && <Agenda {...{ date, setDate, teams, setTeams, activeTechs, customers, services, history, setHistory, updateTask, setNotice }} />}{module === 'history' && <History history={history} />}{module === 'accounts' && <Accounts {...{ customers, setCustomers, setNotice, ask }} />}{module === 'employees' && <Employees {...{ employees, setEmployees, roles, setNotice, ask }} />}{module === 'services' && <ServiceTypes {...{ services, setServices, setNotice, ask }} />}{module === 'settings' && <Settings {...{ roles, setRoles, setNotice, ask }} />}</section></main>{confirmation && <Confirm {...confirmation} close={() => setConfirmation(null)} />}</div>
  return <div className="app-shell" data-theme={theme}><aside className={`sidebar ${menuOpen ? 'open' : ''}`}><div className="brand"><span className="brand-mark">◢</span><div><strong>PIGNUS</strong><small>GUARDIANES POR NATURALEZA</small></div></div><p className="nav-label">MÓDULOS</p><nav>{nav.map(([id, icon, label]) => <button key={id} onClick={() => { setModule(id); setMenuOpen(false) }} className={module === id ? 'active' : ''}><Icon name={icon} />{label}</button>)}</nav><div className="sidebar-bottom">v1.1 · Agenda técnica</div></aside>{menuOpen && <button className="backdrop" aria-label="Cerrar menú" onClick={() => setMenuOpen(false)} />}<main><header className="topbar"><button className="mobile-menu" onClick={() => setMenuOpen(true)}><Icon name="menu" /></button><div className="page-heading"><span>PIGNUS</span><i></i><b>{title}</b></div><div className="profile"><button className="theme-toggle" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}><Icon name={theme === 'light' ? 'moon' : 'sun'} /></button><span className="profile-avatar">LR</span><span>Leonardo Rodríguez</span></div></header><section className="content">{notice && <div className="notice"><span><Icon name="check" size={16} />{notice}</span><button onClick={() => setNotice('')}><Icon name="close" size={16} /></button></div>}{module === 'agenda' && <Agenda {...{ date, setDate, teams, setTeams, activeTechs, customers, services, history, setHistory, updateTask, setNotice }} />}{module === 'history' && <History history={history} />}{module === 'accounts' && <Accounts {...{ customers, setCustomers, setNotice, ask }} />}{module === 'employees' && <Employees {...{ employees, setEmployees, roles, setNotice, ask }} />}{module === 'services' && <ServiceTypes {...{ services, setServices, setNotice, ask }} />}{module === 'settings' && <Settings {...{ roles, setRoles, setNotice, ask }} />}</section></main>{confirmation && <Confirm {...confirmation} close={() => setConfirmation(null)} />}</div>
  return <div className="app-shell" data-theme={theme}><aside className={`sidebar ${menuOpen ? 'open' : ''}`}><div className="brand"><span className="brand-mark">◢</span><div><strong>PIGNUS</strong><small>GUARDIANES POR NATURALEZA</small></div></div><p className="nav-label">MÓDULOS</p><nav>{nav.map(([id, icon, label]) => <button key={id} onClick={() => { setModule(id); setMenuOpen(false) }} className={module === id ? 'active' : ''}><Icon name={icon} />{label}</button>)}</nav><div className="sidebar-bottom">v1.1 · Agenda técnica</div></aside>{menuOpen && <button className="backdrop" aria-label="Cerrar menú" onClick={() => setMenuOpen(false)} />}<main><header className="topbar"><button className="mobile-menu" onClick={() => setMenuOpen(true)}><Icon name="menu" /></button><div className="page-heading"><span>PIGNUS</span><i></i><b>{title}</b></div><div className="profile"><button className="theme-toggle" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}><Icon name={theme === 'light' ? 'moon' : 'sun'} /></button><span className="profile-avatar">LR</span><span>Leonardo Rodríguez</span></div></header><section className="content">{notice && <div className="notice"><span><Icon name="check" size={16} />{notice}</span><button onClick={() => setNotice('')}><Icon name="close" size={16} /></button></div>}{module === 'agenda' && <Agenda {...{ date, setDate, teams, setTeams, activeTechs, customers, services, updateTask, setNotice }} />}{module === 'accounts' && <Accounts {...{ customers, setCustomers, setNotice, ask }} />}{module === 'employees' && <Employees {...{ employees, setEmployees, roles, setNotice, ask }} />}{module === 'services' && <ServiceTypes {...{ services, setServices, setNotice, ask }} />}{module === 'settings' && <Settings {...{ roles, setRoles, setNotice, ask }} />}</section></main>{confirmation && <Confirm {...confirmation} close={() => setConfirmation(null)} />}</div>
  return <div className="app-shell" data-theme={theme}><aside className={`sidebar ${menuOpen ? 'open' : ''}`}><div className="brand"><span className="brand-mark">◢</span><div><strong>PIGNUS</strong><small>GUARDIANES POR NATURALEZA</small></div></div><p className="nav-label">MÓDULOS</p><nav>{nav.map(([id, icon, label]) => <button key={id} onClick={() => { setModule(id); setMenuOpen(false) }} className={module === id ? 'active' : ''}><Icon name={icon} />{label}</button>)}</nav><div className="sidebar-bottom">v1.1 · Agenda técnica</div></aside>{menuOpen && <button className="backdrop" aria-label="Cerrar menú" onClick={() => setMenuOpen(false)} />}<main><header className="topbar"><button className="mobile-menu" onClick={() => setMenuOpen(true)}><Icon name="menu" /></button><div className="page-heading"><span>PIGNUS</span><i></i><b>{title}</b></div><div className="profile"><button className="theme-toggle" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} title={theme === 'light' ? 'Activar modo oscuro' : 'Activar modo claro'}><Icon name={theme === 'light' ? 'moon' : 'sun'} /></button><span className="profile-avatar">LR</span><span>Leonardo Rodríguez</span></div></header><section className="content">{notice && <div className="notice"><span><Icon name="check" size={16} />{notice}</span><button onClick={() => setNotice('')}><Icon name="close" size={16} /></button></div>}{module === 'agenda' && <Agenda {...{ date, setDate, teams, setTeams, activeTechs, customers, updateTask, setNotice }} />}{module === 'accounts' && <Accounts {...{ customers, setCustomers, setNotice, ask }} />}{module === 'employees' && <Employees {...{ employees, setEmployees, roles, setNotice, ask }} />}{module === 'settings' && <Settings {...{ roles, setRoles, setNotice, ask }} />}</section></main>{confirmation && <Confirm {...confirmation} close={() => setConfirmation(null)} />}</div>
}

function Agenda({ date, setDate, teams, setTeams, activeTechs, customers, services, history, setHistory, updateTask, setNotice, weekly, setWeekly }) {
  const SERVICES = services.filter(service => service.status === 'Activo').map(service => service.name)
  const [preview, setPreview] = useState(false); const [techOpen, setTechOpen] = useState(null); const [techFilter, setTechFilter] = useState('')
  const agendaText = `Agenda de trabajo – ${prettyDate(date)}\n\n${teams.map((team, i) => `Equipo ${i + 1}: ${team.members.join(' / ') || 'Sin asignar'}\n${team.tasks.map(t => `${t.time || '--:--'} · ${t.service || 'Servicio'} · ${t.client || 'Cliente'}${t.detail ? `\nDetalle: ${t.detail}` : ''}${t.address ? `\nDirección: ${t.address}` : ''}${t.phone ? `\nContacto: ${t.phone}` : ''}`).join('\n\n')}`).join('\n\n')}`
  const chooseCustomer = (ti, i, value) => { const c = customers.find(x => x.account === value || x.name === value || `${x.name} · ${x.account}` === value); updateTask(ti, i, c ? { client: c.name, address: c.address, phone: c.phone } : { client: value }) }
  const toggleTech = (ti, name) => setTeams(prev => prev.map((t, i) => i !== ti ? t : { ...t, members: t.members.includes(name) ? t.members.filter(x => x !== name) : [...t.members, name] }))
  const addTask = ti => setTeams(prev => prev.map((t, i) => i === ti ? { ...t, tasks: [...t.tasks, blankTask()] } : t))
  return <AgendaLayout {...{ date, setDate, teams, setTeams, activeTechs, customers, services, history, setHistory, updateTask, setNotice, weekly, setWeekly }} />
  return <>{techOpen !== null && <button className="picker-backdrop" aria-label="Cerrar selector de técnicos" onClick={() => setTechOpen(null)} />}<div className="module-intro"><div><p className="eyebrow">PLANIFICACIÓN DIARIA</p><h1>Organizá los trabajos del día</h1><p>Asigná técnicos y servicios para armar la agenda de cada equipo.</p></div><div className="action-group"><button className="secondary" onClick={() => setPreview(true)}><Icon name="eye" />Vista previa</button><button className="primary" onClick={() => { navigator.clipboard?.writeText(agendaText); setNotice('La agenda fue copiada al portapapeles.') }}><Icon name="copy" />Copiar agenda</button></div></div>{!customers.length && <p className="helper">Todavía no hay clientes importados. Podés cargarlos desde <b>Administrador de cuentas</b>.</p>}<div className="agenda-toolbar"><label>Fecha de trabajo<input type="date" value={date} onChange={e => setDate(e.target.value)} /></label><span>{prettyDate(date)}</span></div>{teams.map((team, ti) => <article className="team-card" key={ti}><div className="team-header"><div><span className="team-number">{ti + 1}</span><strong>Equipo {ti + 1}</strong></div><div className="technicians-picker"><span>{team.members.length ? `${team.members.length} técnico(s) asignado(s)` : 'Sin técnicos asignados'}</span><button className="secondary small" onClick={() => { setTechOpen(techOpen === ti ? null : ti); setTechFilter('') }}><Icon name="users" size={16} />Agregar técnicos</button>{techOpen === ti && <div className="tech-popover"><input autoFocus placeholder="Buscar técnico..." value={techFilter} onChange={e => setTechFilter(e.target.value)} /><div className="tech-list">{activeTechs.filter(t => t.name.toLowerCase().includes(techFilter.toLowerCase())).map(t => <label key={t.id}><input type="checkbox" checked={team.members.includes(t.name)} onChange={() => toggleTech(ti, t.name)} />{t.name}</label>)}{!activeTechs.length && <p>No hay técnicos activos.</p>}</div></div>}</div></div><div className="tasks">{team.tasks.map((task, i) => <div className="task-row" key={i}><div className="task-title"><span>{i + 1}</span><b>Servicio</b></div><label>Hora<input type="time" value={task.time} onChange={e => updateTask(ti, i, { time: e.target.value })} /></label><label>Tipo de servicio<select value={task.service} onChange={e => updateTask(ti, i, { service: e.target.value })}><option value="">Seleccionar</option>{SERVICES.map(x => <option key={x}>{x}</option>)}</select></label><label>Cliente o cuenta<input list="customer-options" placeholder="Buscá por nombre o cuenta" value={task.client} onChange={e => chooseCustomer(ti, i, e.target.value)} /><datalist id="customer-options">{customers.map(c => <option key={c.account} value={`${c.name} · ${c.account}`} />)}</datalist></label><label>Dirección<input value={task.address} onChange={e => updateTask(ti, i, { address: e.target.value })} /></label><label>Contacto<input value={task.phone} onChange={e => updateTask(ti, i, { phone: e.target.value })} /></label><label className="observations">Observaciones<textarea value={task.detail} onChange={e => updateTask(ti, i, { detail: e.target.value })} /></label>{team.tasks.length > 1 && <button className="icon-btn delete" onClick={() => setTeams(prev => prev.map((t, x) => x !== ti ? t : { ...t, tasks: t.tasks.filter((_, y) => y !== i) }))}><Icon name="trash" size={16} /></button>}</div>)}</div><button className="link-button" onClick={() => addTask(ti)}><Icon name="plus" size={16} />Agregar servicio</button></article>)}<button className="add-team" onClick={() => setTeams([...teams, { members: [], tasks: [blankTask()] }])}><Icon name="plus" />Agregar otro equipo</button>{preview && <Preview title="Vista previa de la agenda" text={agendaText} close={() => setPreview(false)} />}</>
}

function AgendaLayout({ date, setDate, teams, setTeams, activeTechs, customers, services, history, setHistory, updateTask, setNotice, weekly, setWeekly }) {
  return <AgendaWorkspace {...{ date, setDate, teams, setTeams, activeTechs, customers, services, history, setHistory, updateTask, setNotice, weekly, setWeekly }} />
  const [preview, setPreview] = useState(false)
  const [techOpen, setTechOpen] = useState(null)
  const [filter, setFilter] = useState('')
  const activeServices = services.filter(service => service.status === 'Activo')
  const serviceForTask = task => services.find(service => String(service.id) === String(task.serviceId)) || services.find(service => normalizeServiceName(service.name) === normalizeServiceName(task.service))
  const selectTaskService = (teamIndex, taskIndex, selectedId) => { const selected = services.find(service => String(service.id) === String(selectedId)); updateTask(teamIndex, taskIndex, selected ? { serviceId: selected.id, service: selected.name, installationZone: serviceCode(selected) === 'alarm-installation' ? teams[teamIndex]?.tasks[taskIndex]?.installationZone : '' } : { serviceId: '', service: '', installationZone: '' }) }
  const message = `📅 *Agenda de trabajo – ${prettyDate(date)}*\n\n${teams.map((team, index) => `👥 *Equipo ${index + 1}:* ${team.members.join(' / ') || 'Sin asignar'}\n\n${team.tasks.map(task => `🕒 ${task.time || '--:--'} Hs\n🛠️ *${task.service || 'Servicio'}*\n👤 *${task.client || 'Cliente'}*${task.detail ? `\n📝 *Detalle:* ${task.detail}` : ''}${task.address ? `\n📍 *Dirección:* ${task.address}` : ''}${task.phone ? `\n📞 *Contacto:* ${task.phone}` : ''}`).join('\n\n')}`).join('\n\n┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄\n\n')}`
  const chooseCustomer = (teamIndex, taskIndex, value) => { const customer = customers.find(item => item.account === value || item.name === value || `${item.name} · ${item.account}` === value); updateTask(teamIndex, taskIndex, customer ? { client: customer.name, address: customer.address, phone: customer.phone } : { client: value }) }
  const toggleTechnician = (teamIndex, name) => setTeams(previous => previous.map((team, index) => index !== teamIndex ? team : { ...team, members: team.members.includes(name) ? team.members.filter(member => member !== name) : [...team.members, name] }))
  const removeTeam = index => { if (window.confirm(`¿Querés eliminar el Equipo ${index + 1}?`)) setTeams(previous => previous.filter((_, itemIndex) => itemIndex !== index)) }
  return <>{techOpen !== null && <button className="picker-backdrop" aria-label="Cerrar selector de técnicos" onClick={() => setTechOpen(null)} />}<div className="module-intro"><div><p className="eyebrow">PLANIFICACIÓN DIARIA</p><h1>Organizá los trabajos del día</h1><p>Asigná técnicos y servicios para armar la agenda de cada equipo.</p></div><div className="action-group"><button className="secondary" onClick={() => setPreview(true)}><Icon name="eye" />Vista previa</button><button className="primary" onClick={() => { navigator.clipboard?.writeText(message); setNotice('La agenda fue copiada al portapapeles.') }}><Icon name="copy" />Copiar agenda</button></div></div><div className="agenda-toolbar"><label>Fecha de trabajo<input type="date" value={date} onChange={event => setDate(event.target.value)} /></label><span>{prettyDate(date)}</span></div>{teams.map((team, teamIndex) => <article className="team-card" key={teamIndex}><div className="team-header"><div><span className="team-number">{teamIndex + 1}</span><strong>Equipo {teamIndex + 1}</strong>{teams.length > 1 && <button className="team-delete" onClick={() => removeTeam(teamIndex)} title="Eliminar equipo"><Icon name="trash" size={16} />Eliminar equipo</button>}</div><div className="technicians-picker"><span>{team.members.length ? `${team.members.length} técnico(s) asignado(s)` : 'Sin técnicos asignados'}</span><button className="secondary small" onClick={() => { setTechOpen(techOpen === teamIndex ? null : teamIndex); setFilter('') }}><Icon name="users" size={16} />Agregar técnicos</button>{techOpen === teamIndex && <div className="tech-popover"><input autoFocus placeholder="Buscar técnico..." value={filter} onChange={event => setFilter(event.target.value)} /><div className="tech-list">{activeTechs.filter(tech => tech.name.toLowerCase().includes(filter.toLowerCase())).map(tech => <label key={tech.id}><input type="checkbox" checked={team.members.includes(tech.name)} onChange={() => toggleTechnician(teamIndex, tech.name)} />{tech.name}</label>)}</div></div>}</div></div><div className="tasks">{team.tasks.map((task, taskIndex) => <div className="task-row" key={taskIndex}><div className="task-title"><span>{taskIndex + 1}</span><b>Servicio</b></div><label>Hora<input type="time" value={task.time} onChange={event => updateTask(teamIndex, taskIndex, { time: event.target.value })} /></label><label>Tipo de servicio<select value={task.service} onChange={event => updateTask(teamIndex, taskIndex, { service: event.target.value })}><option value="">Seleccionar</option>{activeServices.map(service => <option key={service.id}>{service.name}</option>)}</select></label><label>Cliente o cuenta<input list="customer-options" value={task.client} placeholder="Buscá por nombre o cuenta" onChange={event => chooseCustomer(teamIndex, taskIndex, event.target.value)} /><datalist id="customer-options">{customers.map(customer => <option key={customer.account} value={`${customer.name} · ${customer.account}`} />)}</datalist></label><label>Dirección<input value={task.address} onChange={event => updateTask(teamIndex, taskIndex, { address: event.target.value })} /></label><label>Contacto<input value={task.phone} onChange={event => updateTask(teamIndex, taskIndex, { phone: event.target.value })} /></label><label className="observations">Observaciones<textarea value={task.detail} onChange={event => updateTask(teamIndex, taskIndex, { detail: event.target.value })} /></label>{team.tasks.length > 1 && <button className="icon-btn delete" onClick={() => setTeams(previous => previous.map((item, index) => index !== teamIndex ? item : { ...item, tasks: item.tasks.filter((_, index) => index !== taskIndex) }))}><Icon name="trash" size={16} /></button>}</div>)}</div><button className="link-button" onClick={() => setTeams(previous => previous.map((item, index) => index === teamIndex ? { ...item, tasks: [...item.tasks, blankTask()] } : item))}><Icon name="plus" size={16} />Agregar servicio</button></article>)}<button className="add-team" onClick={() => setTeams([...teams, { members: [], tasks: [blankTask()] }])}><Icon name="plus" />Agregar otro equipo</button>{preview && <Preview title="Vista previa de la agenda" text={message} close={() => setPreview(false)} />}</>
}

function AgendaWorkspace({ date, setDate, teams, setTeams, activeTechs, customers, services, history, setHistory, updateTask, setNotice, weekly, setWeekly }) {
  return <AgendaWorkspaceForm {...{ date, setDate, teams, setTeams, activeTechs, customers, services, history, setHistory, updateTask, setNotice, weekly, setWeekly }} />
  const [preview, setPreview] = useState(false)
  const [techOpen, setTechOpen] = useState(null)
  const [filter, setFilter] = useState('')
  const [confirmation, setConfirmation] = useState(null)
  useEffect(() => {
    const group = document.querySelector('.module-intro .action-group')
    if (!group || group.querySelector('.save-agenda-button')) return
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'secondary save-agenda-button'
    button.textContent = '✓ Guardar agenda'
    button.onclick = saveAgenda
    group.insertBefore(button, group.lastElementChild)
  })
  const activeServices = services.filter(service => service.status === 'Activo')
  const serviceForTask = task => services.find(service => String(service.id) === String(task.serviceId)) || services.find(service => normalizeServiceName(service.name) === normalizeServiceName(task.service))
  const selectTaskService = (teamIndex, taskIndex, selectedId) => { const selected = services.find(service => String(service.id) === String(selectedId)); updateTask(teamIndex, taskIndex, selected ? { serviceId: selected.id, service: selected.name, installationZone: serviceCode(selected) === 'alarm-installation' ? teams[teamIndex]?.tasks[taskIndex]?.installationZone : '' } : { serviceId: '', service: '', installationZone: '' }) }
  const validateAgenda = () => {
    const missing = []
    // Cada equipo debe contar con al menos un técnico antes de registrar la agenda.
    teams.forEach((team, teamIndex) => {
      if (!team.members.length) missing.push(`Equipo ${teamIndex + 1}: técnicos asignados`)
    })
    teams.forEach((team, teamIndex) => team.tasks.forEach((task, taskIndex) => {
      const fields = []
      if (!task.time) fields.push('hora')
      if (!task.service) fields.push('tipo de servicio')
      if (!task.client) fields.push('abonado o cliente')
      if (!task.address) fields.push('dirección')
      if (serviceCode(serviceForTask(task)) === 'alarm-installation' && !task.installationZone) fields.push('ubicación de la instalación')
      if (fields.length) missing.push(`Equipo ${teamIndex + 1}, servicio ${taskIndex + 1}: ${fields.join(', ')}`)
    }))
    if (!missing.length) return true
    showAgendaValidationModal(missing)
    return false
  }
  const registerHistory = () => {
    if (!validateAgenda()) return false
    const records = teams.flatMap((team, teamIndex) => team.tasks.filter(task => task.service || task.client).map((task, taskIndex) => ({ id: `${date}-${teamIndex}-${taskIndex}-${task.time}-${task.client}-${task.service}`, date, team: `Equipo ${teamIndex + 1}`, technicians: team.members, service: task.service || 'Sin especificar', client: task.client || 'Sin especificar', detail: task.detail, address: task.address, phone: task.phone, status: 'Pendiente' })))
    setHistory(previous => [...records.filter(record => !previous.some(item => item.id === record.id)), ...previous])
    return true
  }
  const clearAgenda = () => { if (confirmation !== 'clear') { requestAgendaAction('copy'); return }; setTeams([{ members: [], tasks: [blankTask()] }]); setDate(new Date().toISOString().slice(0, 10)); setNotice('La agenda quedó limpia y lista para una nueva planificación.') }
  const message = `📅 *Agenda de trabajo – ${prettyDate(date)}*\n\n${teams.map((team, index) => `👥 *Equipo ${index + 1}:* ${team.members.join(' / ') || 'Sin asignar'}\n\n${team.tasks.map(task => `🕒 ${task.time || '--:--'} Hs\n🛠️ *${task.service || 'Servicio'}*\n👤 *${task.client || 'Cliente'}*${task.detail ? `\n📝 *Detalle:* ${task.detail}` : ''}${task.address ? `\n📍 *Dirección:* ${task.address}` : ''}${task.phone ? `\n📞 *Contacto:* ${task.phone}` : ''}`).join('\n\n')}`).join('\n\n┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄\n\n')}`
  const saveAgenda = () => { if (registerHistory()) setNotice('La agenda fue guardada en el historial.') }
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const actionGroup = document.querySelector('.module-intro .action-group')
      if (!actionGroup || actionGroup.querySelector('.save-agenda-button')) return
      const button = document.createElement('button')
      button.type = 'button'; button.className = 'secondary save-agenda-button'; button.textContent = '✓ Guardar agenda'
      button.onclick = saveAgenda
      actionGroup.insertBefore(button, actionGroup.children[1] || null)
    }, 0)
    return () => window.clearTimeout(timer)
  })
  const toggleTech = (teamIndex, name) => setTeams(previous => previous.map((team, index) => index !== teamIndex ? team : { ...team, members: team.members.includes(name) ? team.members.filter(member => member !== name) : [...team.members, name] }))
  const customerChange = (teamIndex, taskIndex, value) => { const customer = customers.find(item => item.account === value || item.name === value || `${item.name} · ${item.account}` === value || `${item.account} ${item.name}` === value); updateTask(teamIndex, taskIndex, customer ? { client: `${customer.account} ${customer.name}`, address: customer.address, phone: customer.phone } : { client: value }) }
  return <><div className="module-intro"><div><p className="eyebrow">PLANIFICACIÓN DIARIA</p><h1>Organizá los trabajos del día</h1><p>Asigná técnicos y servicios para armar la agenda de cada equipo.</p></div><div className="action-group"><button className="secondary" onClick={() => setConfirmation('clear')}><Icon name="trash" />Limpiar agenda</button><button className="secondary" onClick={() => setPreview(true)}><Icon name="eye" />Vista previa</button><button className="primary" onClick={() => { navigator.clipboard?.writeText(message); clearAgenda() }}><Icon name="copy" />Copiar agenda</button></div></div><div className="agenda-toolbar"><label>Fecha de trabajo<input type="date" value={date} onChange={event => setDate(event.target.value)} /></label><span>{prettyDate(date)}</span></div>{teams.map((team, teamIndex) => <article className="team-card" key={teamIndex}><div className="team-header"><div><span className="team-number">{teamIndex + 1}</span><strong>Equipo {teamIndex + 1}</strong>{teams.length > 1 && <button className="team-delete" onClick={() => setConfirmation({ type: 'team', index: teamIndex })}><Icon name="trash" size={16} />Eliminar equipo</button>}</div><div className="technicians-picker"><span>{team.members.length ? `${team.members.length} técnico(s) asignado(s)` : 'Sin técnicos asignados'}</span><button className="secondary small" onClick={() => { setTechOpen(techOpen === teamIndex ? null : teamIndex); setFilter('') }}><Icon name="users" size={16} />Agregar técnicos</button>{techOpen === teamIndex && <div className="tech-popover"><input autoFocus placeholder="Buscar técnico..." value={filter} onChange={event => setFilter(event.target.value)} /><div className="tech-list">{activeTechs.filter(tech => tech.name.toLowerCase().includes(filter.toLowerCase())).map(tech => <label key={tech.id}><input type="checkbox" checked={team.members.includes(tech.name)} onChange={() => toggleTech(teamIndex, tech.name)} />{tech.name}</label>)}</div></div>}</div></div><div className="tasks">{team.tasks.map((task, taskIndex) => <div className="task-row" key={taskIndex}><div className="task-title"><span>{taskIndex + 1}</span><b>Servicio</b></div><label>Hora<input type="time" value={task.time} onChange={event => updateTask(teamIndex, taskIndex, { time: event.target.value })} /></label><label>Tipo de servicio<select value={task.service} onChange={event => updateTask(teamIndex, taskIndex, { service: event.target.value })}><option value="">Seleccionar</option>{activeServices.map(service => <option key={service.id}>{service.name}</option>)}</select></label><label>Cliente o cuenta<input list="customer-options" value={task.client} onChange={event => customerChange(teamIndex, taskIndex, event.target.value)} /><datalist id="customer-options">{customers.map(customer => <option key={customer.account} value={`${customer.name} · ${customer.account}`} />)}</datalist></label><label>Dirección<input value={task.address} onChange={event => updateTask(teamIndex, taskIndex, { address: event.target.value })} /></label><label>Contacto<input value={task.phone} onChange={event => updateTask(teamIndex, taskIndex, { phone: event.target.value })} /></label><label className="observations">Observaciones<textarea value={task.detail} onChange={event => updateTask(teamIndex, taskIndex, { detail: event.target.value })} /></label>{team.tasks.length > 1 && <button className="icon-btn delete" onClick={() => setTeams(previous => previous.map((item, index) => index !== teamIndex ? item : { ...item, tasks: item.tasks.filter((_, index) => index !== taskIndex) }))}><Icon name="trash" size={16} /></button>}</div>)}</div><button className="link-button" onClick={() => setTeams(previous => previous.map((item, index) => index === teamIndex ? { ...item, tasks: [...item.tasks, blankTask()] } : item))}><Icon name="plus" size={16} />Agregar servicio</button></article>)}<button className="add-team" onClick={() => setTeams([...teams, { members: [], tasks: [blankTask()] }])}><Icon name="plus" />Agregar otro equipo</button>{preview && <Preview title="Vista previa de la agenda" text={message} close={() => setPreview(false)} />}{confirmation === 'clear' && <Confirm title="Limpiar agenda" detail="¿Querés borrar todos los equipos y servicios cargados?" destructive action={clearAgenda} close={() => setConfirmation(null)} />}{confirmation?.type === 'team' && <Confirm title="Eliminar equipo" detail={`¿Querés eliminar el Equipo ${confirmation.index + 1}? Esta acción no se puede deshacer.`} destructive action={() => { setTeams(previous => previous.filter((_, index) => index !== confirmation.index)); setNotice('El equipo fue eliminado.') }} close={() => setConfirmation(null)} />}</>
}

function AgendaWorkspaceForm({ date, setDate, teams, setTeams, activeTechs, customers, services, history, setHistory, updateTask, setNotice, weekly, setWeekly }) {
  const saveAgenda = () => requestAgendaAction('save')
  const [preview, setPreview] = useState(false)
  const [techOpen, setTechOpen] = useState(null)
  const [filter, setFilter] = useState('')
  const [confirmation, setConfirmation] = useState(null)
  useEffect(() => {
    // Ambos módulos escriben sobre el mismo día: los cambios de la agenda del día
    // se reflejan inmediatamente en la agenda semanal, conservando campos extra.
    const hasContent = teams.some(team => team.members?.length || team.tasks.some(task => Object.entries(task).some(([key, value]) => !['time', 'taskId', 'historyId'].includes(key) && String(value || '').trim())))
    if (!hasContent) return
    setWeekly(previous => {
      const savedDay = previous[date] || {}
      const nextTeams = teams.map((team, teamIndex) => {
        const savedTeam = savedDay.teams?.[teamIndex] || {}
        return {
          ...savedTeam,
          label: savedTeam.label || `Equipo ${teamIndex + 1}`,
          members: team.members || [],
          tasks: team.tasks.map((task, taskIndex) => ({ ...(savedTeam.tasks?.[taskIndex] || {}), ...task }))
        }
      })
      const nextDay = { ...savedDay, teams: nextTeams }
      return JSON.stringify(savedDay) === JSON.stringify(nextDay) ? previous : { ...previous, [date]: nextDay }
    })
  }, [date, teams, setWeekly])
  useEffect(() => {
    // Migra agendas creadas antes del identificador estable sin alterar sus datos.
    setTeams(previous => {
      let changed = false
      const next = previous.map(team => ({ ...team, tasks: team.tasks.map(task => {
        if (task.taskId) return task
        changed = true
        return { ...task, taskId: createTaskId() }
      }) }))
      return changed ? next : previous
    })
  }, [setTeams])
  useEffect(() => {
    // Expone los integrantes junto al título de cada equipo, sin obligar a abrir el selector.
    document.querySelectorAll('.team-header > div:first-child').forEach((header, teamIndex) => {
      header.querySelector('.team-members')?.remove()
      const members = teams[teamIndex]?.members || []
      if (!members.length) return
      const names = document.createElement('span')
      names.className = 'team-members'
      names.textContent = members.join(' · ')
      names.title = members.join(', ')
      header.querySelector('strong')?.insertAdjacentElement('afterend', names)
    })
  }, [teams])
  // Reconstruye la agenda desde los registros ya guardados para la fecha elegida.
  const loadAgendaForDate = nextDate => {
    const saved = history.filter(record => record.date === nextDate && ['Pendiente', 'Reprogramado', 'Requiere revisión'].includes(record.status || 'Pendiente'))
    setDate(nextDate)
    const weeklyDay = weekly?.[nextDate]
    if (!saved.length && !weeklyDay?.teams?.length) {
      setTeams([{ teamId: createTeamId(), memberIds: [], members: [], tasks: [blankTask()] }])
      setNotice('No hay una agenda guardada para la fecha seleccionada. Podés crear una nueva.')
      return
    }
    const byTeam = new Map()
    ;(weeklyDay?.teams || []).forEach((team, index) => {
      const position = Number(String(team.label || '').match(/\d+/)?.[0]) || index + 1
      const teamKey = team.teamId || `legacy-team-${position}`
      byTeam.set(teamKey, {
        ...team,
        position,
        teamId: team.teamId || createTeamId(),
        memberIds: team.memberIds || [],
        members: team.members || [],
        tasks: (team.tasks || []).filter(task => task.service || task.client || task.historyId).map(task => ({ ...blankTask(), ...task }))
      })
    })
    saved.forEach(record => {
      const number = Number(String(record.team || '').match(/\d+/)?.[0]) || 1
      const teamKey = record.teamId || `legacy-team-${number}`
      const current = byTeam.get(teamKey) || { position: number, teamId: record.teamId || createTeamId(), memberIds: record.technicianIds || [], members: record.technicians || [], tasks: [] }
      current.teamId ||= record.teamId || createTeamId()
      current.memberIds = record.technicianIds?.length ? record.technicianIds : current.memberIds
      current.members = record.technicians?.length ? record.technicians : current.members
      // Se aceptan los nombres anteriores del campo para recuperar también agendas ya existentes.
      const recoveredTask = { taskId: record.sourceTaskId || record.id || createTaskId(), historyId: record.id, time: record.time || record.scheduledTime || record.hora || record.Hora || '', serviceId: record.serviceId || '', service: record.service || '', customerId: record.customerId || '', client: record.client || '', clientAccount: record.clientAccount || record.account || '', clientNameAtService: record.clientNameAtService || '', address: record.address || '', phone: record.phone || '', detail: record.detail || '', installationZone: record.installationZone || '' }
      const sameTask = task => (record.id && String(task.historyId || '') === String(record.id)) || (record.sourceTaskId && String(task.taskId || '') === String(record.sourceTaskId))
      if (current.tasks.some(sameTask)) current.tasks = current.tasks.map(task => sameTask(task) ? { ...task, ...recoveredTask } : task)
      else current.tasks.push(recoveredTask)
      byTeam.set(teamKey, current)
    })
    setTeams([...byTeam.values()].sort((a, b) => a.position - b.position).map(({ position, ...team }) => ({ ...team, tasks: (team.tasks.length ? team.tasks : [blankTask()]).sort((a, b) => String(a.time).localeCompare(String(b.time))) })))
    const reprogrammedCount = saved.filter(record => record.rescheduledFrom).length
    setNotice(reprogrammedCount
      ? `Se cargó la agenda del ${prettyDate(nextDate)} con ${reprogrammedCount} servicio(s) reprogramado(s).`
      : `Se recuperó la agenda guardada del ${prettyDate(nextDate)}.`)
  }
  useEffect(() => {
    const input = document.querySelector('.agenda-toolbar input[type="date"]')
    if (!input) return undefined
    const selectDate = event => loadAgendaForDate(event.target.value)
    input.addEventListener('change', selectDate, true)
    return () => input.removeEventListener('change', selectDate, true)
  }, [history, weekly])
  // El guardado es independiente de copiar: registra la agenda y mantiene los campos cargados.
  useEffect(() => {
    const actionGroup = document.querySelector('.module-intro .action-group')
    if (!actionGroup) return undefined
    actionGroup.querySelector('.save-agenda-button')?.remove()
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'secondary save-agenda-button'
    button.textContent = '✓ Guardar agenda'
    button.onclick = saveAgenda
    actionGroup.insertBefore(button, actionGroup.lastElementChild)
    return () => button.remove()
  }, [date, teams, history, activeTechs])
  useEffect(() => {
    // Evita copiar al portapapeles o guardar antes de validar la asignación de técnicos.
    const copyButton = document.querySelector('.module-intro .action-group .primary')
    if (!copyButton) return undefined
    const intercept = event => { event.preventDefault(); event.stopPropagation(); requestAgendaAction('copy') }
    copyButton.addEventListener('click', intercept, true)
    return () => copyButton.removeEventListener('click', intercept, true)
  }, [date, teams, history, activeTechs])
  const activeServices = services.filter(service => service.status === 'Activo')
  const serviceForTask = task =>
    services.find(service => String(service.id) === String(task.serviceId)) ||
    services.find(service => normalizeServiceName(service.name) === normalizeServiceName(task.service))
  const selectTaskService = (teamIndex, taskIndex, selectedId) => {
    const selected = services.find(service => String(service.id) === String(selectedId))
    const currentTask = teams[teamIndex]?.tasks[taskIndex]
    updateTask(teamIndex, taskIndex, selected
      ? {
          serviceId: selected.id,
          service: selected.name,
          installationZone: serviceCode(selected) === 'alarm-installation' ? currentTask?.installationZone || '' : ''
        }
      : { serviceId: '', service: '', installationZone: '' })
  }
  const validateAgenda = () => {
    const missing = []
    teams.forEach((team, teamIndex) => team.tasks.forEach((task, taskIndex) => {
      const fields = []
      if (!task.time) fields.push('hora')
      if (!task.service) fields.push('tipo de servicio')
      if (!task.customerId) fields.push('abonado o cliente registrado')
      if (!task.address) fields.push('dirección')
      if (serviceCode(serviceForTask(task)) === 'alarm-installation' && !task.installationZone) fields.push('ubicación de la instalación')
      if (fields.length) missing.push(`Equipo ${teamIndex + 1}, servicio ${taskIndex + 1}: ${fields.join(', ')}`)
    }))
    if (!missing.length) return true
    showAgendaValidationModal(missing)
    return false
  }
  const clearAgenda = () => { if (confirmation !== 'clear') { if (!registerHistory()) return; setNotice('La agenda fue copiada al portapapeles y registrada en el historial.'); return }; setTeams([{ teamId: createTeamId(), memberIds: [], members: [], tasks: [blankTask()] }]); setDate(new Date().toISOString().slice(0, 10)); setNotice('La agenda quedó limpia y lista para una nueva planificación.') }
  const message = `📅 *Agenda de trabajo – ${prettyDate(date)}*\n\n${teams.map((team, index) => `👥 *Equipo ${index + 1}:* ${team.members.join(' / ') || 'Sin asignar'}\n\n${team.tasks.map(task => `🕒 ${task.time || '--:--'} Hs\n🛠️ *${task.service || 'Servicio'}*\n👤 *${task.client || 'Cliente'}*${task.detail ? `\n📝 *Detalle:* ${task.detail}` : ''}${task.address ? `\n📍 *Dirección:* ${task.address}` : ''}${task.phone ? `\n📞 *Contacto:* ${task.phone}` : ''}`).join('\n\n')}`).join('\n\n┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄\n\n')}`
  const registerHistory = () => {
    if (!validateAgenda()) return false
    setHistory(previous => {
      const records = teams.flatMap((team, teamIndex) => team.tasks.map((task, taskIndex) => ({
        // historyId se conserva al recuperar o editar una agenda ya registrada.
        // Para un servicio nuevo se usa el taskId, que permanece aunque cambien sus datos.
        id: task.historyId || `work-${task.taskId || `${date}-${teamIndex}-${taskIndex}`}`,
        sourceTaskId: task.taskId,
        date, time: task.time, scheduledTime: task.time, team: `Equipo ${teamIndex + 1}`,
        // El historial conserva el titular original aunque la cuenta se reasigne después.
        teamId: team.teamId, technicianIds: team.memberIds || [], technicians: team.members, serviceId: serviceForTask(task)?.id || task.serviceId, service: serviceForTask(task)?.name || task.service, client: task.client,
        customerId: task.customerId || '',
        clientAccount: task.clientAccount || '',
        clientNameAtService: task.clientNameAtService || task.client.replace(/^[^\s]+\s+/, ''), detail: task.detail,
        address: task.address, phone: task.phone, installationZone: task.installationZone || ''
      })))
      const accountKey = record => String(record.clientAccount || record.account || String(record.client || '').trim().split(' ')[0] || '').trim().toUpperCase()
      const serviceKey = record => String(record.service || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/nueva/g, '').replace(/\s+/g, ' ').trim()
      const replacements = records.map(record => {
        // Compatibilidad con la importación histórica: si ya existe el mismo trabajo,
        // se completa ese registro en lugar de agregar una segunda fila.
        const existing = previous.find(item => item.id === record.id || (
          item.date === record.date && accountKey(item) && accountKey(item) === accountKey(record) && serviceKey(item) === serviceKey(record)
        ))
        return existing ? { ...existing, ...record, id: existing.id } : { ...record, status: 'Pendiente' }
      })
      const replacedIds = new Set(replacements.map(record => record.id))
      return [...replacements, ...previous.filter(record => !replacedIds.has(record.id))]
    })
    return true
  }
  const finishAgendaAction = action => {
    if (!registerHistory()) return
    if (action === 'copy') navigator.clipboard?.writeText(message)
    setNotice(action === 'copy' ? 'La agenda fue copiada al portapapeles y registrada en el historial.' : 'La agenda fue guardada en el historial.')
  }
  const requestAgendaAction = (action, allowWithoutTechnicians = false) => {
    if (!validateAgenda()) return
    const missingTeams = teams.map((team, index) => !team.members.length ? `Equipo ${index + 1}` : '').filter(Boolean)
    if (missingTeams.length && !allowWithoutTechnicians) { showMissingTechniciansModal(missingTeams, () => requestAgendaAction(action, true)); return }
    const technicianTeams = new Map()
    teams.forEach((team, teamIndex) => team.members.forEach(name => technicianTeams.set(name, [...(technicianTeams.get(name) || []), teamIndex])))
    const duplicates = [...technicianTeams.entries()].filter(([, assignedTeams]) => assignedTeams.length > 1).map(([name, assignedTeams]) => ({ name, teams: assignedTeams }))
    if (duplicates.length) {
      const assigned = new Set(teams.flatMap(team => team.members))
      const available = activeTechs.map(tech => tech.name).filter(name => !assigned.has(name))
      showDuplicateTechniciansModal(duplicates, available, changes => {
        setTeams(previous => previous.map((team, teamIndex) => ({ ...team, members: team.members.map(name => changes.find(change => change.teamIndex === teamIndex && change.name === name)?.replacement || name) })))
        setNotice('La asignación fue corregida. Revisá la agenda y volvé a guardar o copiar.')
      }, () => finishAgendaAction(action))
      return
    }
    finishAgendaAction(action)
  }
  const toggleTech = (teamIndex, technician) => setTeams(previous => previous.map((team, index) => {
    if (index !== teamIndex) return team
    const selected = (team.memberIds || []).some(id => String(id) === String(technician.id))
    return { ...team, teamId: team.teamId || createTeamId(), memberIds: selected ? (team.memberIds || []).filter(id => String(id) !== String(technician.id)) : [...(team.memberIds || []), technician.id], members: selected ? (team.members || []).filter(name => name !== technician.name) : [...(team.members || []), technician.name] }
  }))
  const customerChange = (teamIndex, taskIndex, value) => { const customer = customers.find(item => item.account === value || item.name === value || `${item.name} · ${item.account}` === value || `${item.account} ${item.name}` === value); updateTask(teamIndex, taskIndex, customer ? { customerId: customer.customerId, client: `${customer.account} ${customer.name}`, clientAccount: customer.account, clientNameAtService: customer.name, address: customer.address, phone: customer.phone } : { customerId: '', client: value, clientAccount: '', clientNameAtService: '' }) }
  return <><div className="module-intro"><div><p className="eyebrow">PLANIFICACIÓN DIARIA</p><h1>Organizá los trabajos del día</h1><p>Asigná técnicos y servicios para armar la agenda de cada equipo.</p></div><div className="action-group"><button className="secondary" onClick={() => setConfirmation('clear')}><Icon name="trash" />Limpiar agenda</button><button className="secondary" onClick={() => setPreview(true)}><Icon name="eye" />Vista previa</button><button className="primary" onClick={() => { navigator.clipboard?.writeText(message); clearAgenda() }}><Icon name="copy" />Copiar agenda</button></div></div><div className="agenda-toolbar"><label>Fecha de trabajo<input type="date" value={date} onChange={event => setDate(event.target.value)} /></label><span>{prettyDate(date)}</span></div>{teams.map((team, teamIndex) => <article className="team-card" key={team.teamId || teamIndex}><div className="team-header"><div><span className="team-number">{teamIndex + 1}</span><strong>Equipo {teamIndex + 1}</strong>{teams.length > 1 && <button className="team-delete" onClick={() => setConfirmation({ type: 'team', index: teamIndex })}><Icon name="trash" size={16} />Eliminar equipo</button>}</div><div className="technicians-picker"><span>{team.members.length ? `${team.members.length} técnico(s) asignado(s)` : 'Sin técnicos asignados'}</span><button className="secondary small" onClick={() => { setTechOpen(techOpen === teamIndex ? null : teamIndex); setFilter('') }}><Icon name="users" size={16} />Agregar técnicos</button>{techOpen === teamIndex && <div className="tech-popover"><input autoFocus placeholder="Buscar técnico..." value={filter} onChange={event => setFilter(event.target.value)} /><div className="tech-list">{activeTechs.filter(tech => tech.name.toLowerCase().includes(filter.toLowerCase())).map(tech => <label key={tech.id}><input type="checkbox" checked={(team.memberIds || []).some(id => String(id) === String(tech.id))} onChange={() => toggleTech(teamIndex, tech)} />{tech.name}</label>)}</div></div>}</div></div><div className="tasks">{team.tasks.map((task, taskIndex) => <div className="task-row" key={taskIndex}><div className="task-title"><span>{taskIndex + 1}</span><b>Servicio</b></div><label>Hora<input type="time" value={task.time} onChange={event => updateTask(teamIndex, taskIndex, { time: event.target.value })} /></label><label>Tipo de servicio<select value={serviceForTask(task)?.id || ''} onChange={event => selectTaskService(teamIndex, taskIndex, event.target.value)}><option value="">Seleccionar</option>{activeServices.map(service => <option key={service.id} value={service.id}>{service.name}</option>)}</select></label><label>Cliente o cuenta<input list="customer-options" value={task.client} onChange={event => customerChange(teamIndex, taskIndex, event.target.value)} /><datalist id="customer-options">{customers.map(customer => <option key={customer.account} value={`${customer.name} · ${customer.account}`} />)}</datalist></label><label>Dirección<input value={task.address} onChange={event => updateTask(teamIndex, taskIndex, { address: event.target.value })} /></label><label>Contacto<input value={task.phone} onChange={event => updateTask(teamIndex, taskIndex, { phone: event.target.value })} /></label><label className="observations">Observaciones<textarea value={task.detail} onChange={event => updateTask(teamIndex, taskIndex, { detail: event.target.value })} /></label>{serviceCode(serviceForTask(task)) === 'alarm-installation' && <fieldset className="installation-zone"><legend>Ubicación de la instalación</legend>{[['docta', 'Docta Urbanización'], ['nobu-town', 'Nobu Town'], ['residencial', 'Residencial']].map(([value, label]) => <label key={value}><input type="radio" name={`zone-${teamIndex}-${taskIndex}`} checked={task.installationZone === value} onChange={() => updateTask(teamIndex, taskIndex, { installationZone: value })} />{label}</label>)}</fieldset>}{team.tasks.length > 1 && <button className="icon-btn delete" onClick={() => setTeams(previous => previous.map((item, index) => index !== teamIndex ? item : { ...item, tasks: item.tasks.filter((_, index) => index !== taskIndex) }))}><Icon name="trash" size={16} /></button>}</div>)}</div><button className="link-button" onClick={() => setTeams(previous => previous.map((item, index) => index === teamIndex ? { ...item, tasks: [...item.tasks, blankTask()] } : item))}><Icon name="plus" size={16} />Agregar servicio</button></article>)}<button className="add-team" onClick={() => setTeams([...teams, { teamId: createTeamId(), memberIds: [], members: [], tasks: [blankTask()] }])}><Icon name="plus" />Agregar otro equipo</button>{preview && <Preview title="Vista previa de la agenda" text={message} close={() => setPreview(false)} />}{confirmation === 'clear' && <Confirm title="Limpiar agenda" detail="¿Querés borrar todos los equipos y servicios cargados?" destructive action={clearAgenda} close={() => setConfirmation(null)} />}{confirmation?.type === 'team' && <Confirm title="Eliminar equipo" detail={`¿Querés eliminar el Equipo ${confirmation.index + 1}? Esta acción no se puede deshacer.`} destructive action={() => { setTeams(previous => previous.filter((_, index) => index !== confirmation.index)); setNotice('El equipo fue eliminado.') }} close={() => setConfirmation(null)} />}</>
}

/**
 * Planificador semanal: es el espacio de preparación previa. Sus tarjetas no
 * impactan en el Historial hasta que el operador abre y guarda la agenda diaria.
 */
function WeeklyPlanner({ weekly, setWeekly, customers, services, activeTechs, setNotice, openDaily }) {
  const localToday = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' })
  const [today, setToday] = useState(localToday)
  const [anchor, setAnchor] = useState(today)
  const [monthlySetup, setMonthlySetup] = useState(null)
  const [techPicker, setTechPicker] = useState(null)
  const [techFilter, setTechFilter] = useState('')
  const [taskEditor, setTaskEditor] = useState(null)
  const [teamRemoval, setTeamRemoval] = useState(null)
  const weeklyBoardRef = useRef(null)
  const weeklyTopScrollRef = useRef(null)
  const [weeklyScrollWidth, setWeeklyScrollWidth] = useState(0)
  const syncWeeklyScroll = (source, target) => {
    if (!source || !target) return
    const sourceRange = Math.max(0, source.scrollWidth - source.clientWidth)
    const targetRange = Math.max(0, target.scrollWidth - target.clientWidth)
    const nextPosition = sourceRange ? (source.scrollLeft / sourceRange) * targetRange : 0
    if (Math.abs(target.scrollLeft - nextPosition) > 0.5) target.scrollLeft = nextPosition
  }
  const activeServices = services.filter(service => service.status === 'Activo')
  const serviceForWeeklyTask = task => services.find(service => String(service.id) === String(task.serviceId)) || services.find(service => normalizeServiceName(service.name) === normalizeServiceName(task.service))
  const selectWeeklyService = (day, teamIndex, taskIndex, selectedId) => { const selected = services.find(service => String(service.id) === String(selectedId)); updateTask(day, teamIndex, taskIndex, selected ? { serviceId: selected.id, service: selected.name } : { serviceId: '', service: '' }) }
  const weeklyTechnicianName = fullName => activeTechs.find(tech => tech.name === fullName)?.firstName || String(fullName || '').split(' ')[0]
  const monthKey = anchor.slice(0, 7)
  const monthlyTeams = weekly._monthlyTeams || {}
  const previousMonthKey = (() => { const value = new Date(`${monthKey}-01T12:00:00`); value.setMonth(value.getMonth() - 1); return value.toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' }).slice(0, 7) })()
  const baseTeams = monthlyTeams[monthKey]?.teams
  const createTeam = (index, source) => ({ teamId: source?.teamId || createTeamId(), memberIds: source?.memberIds || [], members: source?.members || [], tasks: [{ ...blankTask(), time: '08:30' }, { ...blankTask(), time: '13:00' }], label: source?.label || `Equipo ${index + 1}` })
  const createDay = day => ({ teams: (monthlyTeams[day.slice(0, 7)]?.teams || [null, null, null]).map((team, index) => createTeam(index, team)) })
  const monday = useMemo(() => {
    const value = new Date(`${anchor}T12:00:00`)
    value.setDate(value.getDate() - ((value.getDay() + 6) % 7))
    return value
  }, [anchor])
  const days = useMemo(() => Array.from({ length: 7 }, (_, index) => {
    const value = new Date(monday)
    value.setDate(monday.getDate() + index)
    return value.toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' })
  }), [monday])
  useEffect(() => {
    // Mantiene la ventana semanal vigente aunque la pantalla permanezca abierta a medianoche.
    const refreshDay = () => setToday(localToday())
    const now = new Date()
    const nextMidnight = new Date(now)
    nextMidnight.setHours(24, 0, 1, 0)
    const timeout = window.setTimeout(refreshDay, nextMidnight.getTime() - now.getTime())
    return () => window.clearTimeout(timeout)
  }, [today])
  useEffect(() => {
    const board = weeklyBoardRef.current
    if (!board) return
    const currentDay = board.querySelector(`[data-day="${today}"]`)
    if (!currentDay) {
      board.scrollLeft = 0
      return
    }
    const boardRect = board.getBoundingClientRect()
    const dayRect = currentDay.getBoundingClientRect()
    board.scrollLeft += dayRect.left - boardRect.left
    syncWeeklyScroll(board, weeklyTopScrollRef.current)
  }, [days, today])
  useEffect(() => {
    const board = weeklyBoardRef.current
    if (!board) return
    const updateWidth = () => {
      const topScroll = weeklyTopScrollRef.current
      const boardRange = Math.max(0, board.scrollWidth - board.clientWidth)
      setWeeklyScrollWidth(boardRange + (topScroll?.clientWidth || board.clientWidth))
      window.requestAnimationFrame(() => syncWeeklyScroll(board, topScroll))
    }
    updateWidth()
    const observer = new ResizeObserver(updateWidth)
    observer.observe(board)
    if (weeklyTopScrollRef.current) observer.observe(weeklyTopScrollRef.current)
    Array.from(board.children).forEach(column => observer.observe(column))
    return () => observer.disconnect()
  }, [days, weekly])
  const dayPlan = day => weekly[day] || createDay(day)
  const updateDay = (day, mutate) => setWeekly(previous => ({ ...previous, [day]: mutate(previous[day] || createDay(day)) }))
  const updateTeam = (day, teamIndex, patch) => updateDay(day, plan => ({ ...plan, teams: plan.teams.map((team, index) => index === teamIndex ? { ...team, ...patch } : team) }))
  const toggleWeeklyTech = (day, teamIndex, technician) => {
    technician = typeof technician === 'string' ? activeTechs.find(item => item.name === technician) : technician
    if (!technician) return
    const team = dayPlan(day).teams[teamIndex] || {}
    const selected = (team.memberIds || []).some(id => String(id) === String(technician.id))
    updateTeam(day, teamIndex, { teamId: team.teamId || createTeamId(), memberIds: selected ? (team.memberIds || []).filter(id => String(id) !== String(technician.id)) : [...(team.memberIds || []), technician.id], members: selected ? (team.members || []).filter(name => name !== technician.name) : [...(team.members || []), technician.name] })
  }
  const updateTask = (day, teamIndex, taskIndex, patch) => updateDay(day, plan => ({ ...plan, teams: plan.teams.map((team, index) => index !== teamIndex ? team : { ...team, tasks: team.tasks.map((task, index) => index === taskIndex ? { ...task, ...patch } : task) }) }))
  const addTeam = day => updateDay(day, plan => ({ ...plan, teams: [...plan.teams, createTeam(plan.teams.length)] }))
  const removeWeeklyTeam = (day, teamIndex) => {
    updateDay(day, plan => ({
      ...plan,
      teams: plan.teams.filter((_, index) => index !== teamIndex).map((team, index) => ({
        ...team,
        label: /^Equipo \d+$/.test(team.label || '') ? `Equipo ${index + 1}` : team.label
      }))
    }))
    setTechPicker(null)
    setNotice('El equipo fue eliminado.')
  }
  const hoursForDay = day => {
    const weekDay = new Date(`${day}T12:00:00`).getDay()
    if (weekDay === 0) return null
    return { min: '08:00', max: weekDay === 5 ? '20:00' : weekDay === 6 ? '12:00' : '17:00', label: weekDay === 5 ? '08:00 a 20:00' : weekDay === 6 ? '08:00 a 12:00' : '08:00 a 17:00' }
  }
  const conflictsForDay = day => {
    const bookings = new Map()
    dayPlan(day).teams.forEach((team, teamIndex) => team.tasks.filter(task => task.time).forEach(task => (team.memberIds || []).forEach(employeeId => {
      const key = `${employeeId}|${task.time}`
      bookings.set(key, [...(bookings.get(key) || []), teamIndex + 1])
    })))
    return [...bookings.entries()].filter(([, assignedTeams]) => new Set(assignedTeams).size > 1).map(([key, assignedTeams]) => {
      const [employeeId, time] = key.split('|')
      return { name: activeTechs.find(employee => String(employee.id) === employeeId)?.name || 'Técnico', time, teams: [...new Set(assignedTeams)] }
    })
  }
  const selectCustomer = (day, teamIndex, taskIndex, value) => {
    const customer = customers.find(item => item.account === value || item.name === value || `${item.account} ${item.name}` === value)
    updateTask(day, teamIndex, taskIndex, customer ? { customerId: customer.customerId, client: `${customer.account} ${customer.name}`, clientAccount: customer.account, clientNameAtService: customer.name, address: customer.address, phone: customer.phone } : { customerId: '', client: value, clientAccount: '', clientNameAtService: '' })
  }
  const addTask = (day, teamIndex) => updateDay(day, plan => ({ ...plan, teams: plan.teams.map((team, index) => index === teamIndex ? { ...team, tasks: [...team.tasks, { ...blankTask(), time: '' }] } : team) }))
  const suggestedMonthlyTeams = () => (monthlyTeams[previousMonthKey]?.teams || [null, null, null]).map((team, index) => ({ teamId: team?.teamId || createTeamId(), label: team?.label || `Equipo ${index + 1}`, memberIds: team?.memberIds || [], members: team?.members || [] }))
  const openMonthlySetup = () => setMonthlySetup({ month: monthKey, teams: baseTeams ? baseTeams.map(team => ({ teamId: team.teamId || createTeamId(), label: team.label, memberIds: team.memberIds || [], members: team.members || [] })) : suggestedMonthlyTeams() })
  const updateMonthlyTeam = (index, memberIds) => { const selected = activeTechs.filter(tech => memberIds.some(id => String(id) === String(tech.id))); setMonthlySetup(previous => ({ ...previous, teams: previous.teams.map((team, teamIndex) => teamIndex === index ? { ...team, memberIds: selected.map(tech => tech.id), members: selected.map(tech => tech.name) } : team) })) }
  const addMonthlyTeam = () => setMonthlySetup(previous => ({ ...previous, teams: [...previous.teams, { teamId: createTeamId(), label: `Equipo ${previous.teams.length + 1}`, memberIds: [], members: [] }] }))
  const saveMonthlySetup = () => {
    setWeekly(previous => ({ ...previous, _monthlyTeams: { ...(previous._monthlyTeams || {}), [monthlySetup.month]: { teams: monthlySetup.teams } } }))
    setMonthlySetup(null)
    setNotice(`Los equipos predeterminados de ${new Date(`${monthKey}-01T12:00:00`).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })} fueron guardados.`)
  }
  useEffect(() => {
    // Al comenzar un nuevo mes se solicita confirmar la rotación del equipo.
    if (!monthlyTeams[monthKey] && monthlySetup?.month !== monthKey) setMonthlySetup({ month: monthKey, teams: suggestedMonthlyTeams() })
  }, [monthKey, monthlyTeams[monthKey]])
  const openDay = day => {
    const hours = hoursForDay(day)
    if (!hours) { setNotice('Los domingos no están habilitados para programar servicios.'); return }
    const invalidTime = dayPlan(day).teams.flatMap(team => team.tasks).find(task => task.time && (task.time < hours.min || task.time > hours.max))
    if (invalidTime) { setNotice(`Hay horarios fuera del rango permitido para este día (${hours.label}).`); return }
    const scheduledTasks = dayPlan(day).teams.flatMap((team, teamIndex) => team.tasks.map((task, taskIndex) => ({ task, teamIndex, taskIndex }))).filter(({ task }) => [task.service, task.client, task.address, task.detail, task.phone, task.paymentMethod, task.monthlyFee, task.form].some(value => String(value || '').trim()))
    const incompleteTask = scheduledTasks.find(({ task }) => !task.time || !task.service || !task.customerId || !task.address || !task.detail)
    if (incompleteTask) {
      const { task, teamIndex, taskIndex } = incompleteTask
      const missing = [['hora', task.time], ['tipo de servicio', task.service], ['cliente', task.client], ['dirección', task.address], ['detalle', task.detail]].filter(([, value]) => !String(value || '').trim()).map(([label]) => label)
      setNotice(`Completá los campos obligatorios de Equipo ${teamIndex + 1}, tarjeta ${taskIndex + 1}: ${missing.join(', ')}.`)
      return
    }
    const conflicts = conflictsForDay(day)
    if (conflicts.length) { setNotice(`Conflicto de asignación: ${conflicts.map(item => `${item.name} a las ${item.time} (equipos ${item.teams.join(' y ')})`).join('; ')}.`); return }
    const teams = dayPlan(day).teams.map(({ teamId, memberIds, members, tasks }) => ({ teamId, memberIds, members, tasks }))
    openDaily(day, teams)
    setNotice(`Se cargó la planificación semanal del ${prettyDate(day)} en la agenda técnica.`)
  }
  const displayDate = day => new Date(`${day}T12:00:00`).toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short' }).replace('.', '')
  return <>
    {techPicker && <button className="picker-backdrop" aria-label="Cerrar selector de técnicos" onClick={() => setTechPicker(null)} />}
    {teamRemoval && <Confirm title="Quitar equipo" detail={`¿Querés quitar ${teamRemoval.label} de la planificación del ${prettyDate(teamRemoval.day)}? Se eliminarán también sus servicios.`} destructive action={() => removeWeeklyTeam(teamRemoval.day, teamRemoval.teamIndex)} close={() => setTeamRemoval(null)} />}
    {monthlySetup && <div className="modal-backdrop monthly-backdrop"><section className="modal monthly-teams-modal" role="dialog" aria-modal="true"><button className="modal-close" onClick={() => setMonthlySetup(null)}><Icon name="close" /></button><p className="eyebrow">CONFIGURACIÓN MENSUAL</p><h2>Equipos de {new Date(`${monthlySetup.month}-01T12:00:00`).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })}</h2><p>Estos técnicos se asignarán por defecto a cada nuevo día del mes. Las agendas ya cargadas no se modifican.</p><div className="monthly-team-list">{monthlySetup.teams.map((team, index) => <label key={team.teamId || index}><b>{team.label || `Equipo ${index + 1}`}</b><select multiple value={team.memberIds || []} onChange={event => updateMonthlyTeam(index, [...event.target.selectedOptions].map(option => option.value))}>{activeTechs.map(tech => <option key={tech.id} value={tech.id}>{tech.firstName || tech.name.split(' ')[0]}</option>)}</select><small>Mantené presionada la tecla Ctrl para seleccionar más de un técnico.</small></label>)}</div><button className="secondary monthly-add-team" onClick={addMonthlyTeam}><Icon name="plus" size={15} />Agregar equipo</button><div className="modal-actions"><button className="secondary" onClick={() => setMonthlySetup(null)}>Cancelar</button><button className="primary" onClick={saveMonthlySetup}>Guardar equipos del mes</button></div></section></div>}
    <div className="module-intro weekly-intro"><div><p className="eyebrow">PLANIFICACIÓN SEMANAL</p><h1>Agenda semanal</h1><p>Prepará las visitas de cada equipo y luego abrí el día para terminar de validar y guardar la agenda del día.</p></div><div className="weekly-actions"><button className="secondary" onClick={openMonthlySetup}><Icon name="users" size={16} />Equipos del mes</button><label className="week-selector">Semana de trabajo<input type="date" value={anchor} onChange={event => setAnchor(event.target.value)} /></label></div></div>
    {taskEditor && (() => {
      const { day, teamIndex, taskIndex } = taskEditor
      const task = dayPlan(day).teams[teamIndex]?.tasks[taskIndex]
      const hours = hoursForDay(day)
      if (!task || !hours) return null
      const customerListId = `weekly-customers-editor-${day}-${teamIndex}-${taskIndex}`
      return <div className="modal-backdrop weekly-editor-backdrop" onMouseDown={() => setTaskEditor(null)}><section className="modal weekly-task-modal" role="dialog" aria-modal="true" aria-label={`Servicio ${taskIndex + 1}`} onMouseDown={event => event.stopPropagation()}><button className="modal-close" onClick={() => setTaskEditor(null)}><Icon name="close" /></button><p className="eyebrow">AGENDA SEMANAL · {prettyDate(day)}</p><h2>Servicio {taskIndex + 1}</h2><p className="weekly-modal-team">{dayPlan(day).teams[teamIndex]?.label || `Equipo ${teamIndex + 1}`} · {dayPlan(day).teams[teamIndex]?.members?.join(' / ') || 'Sin técnicos asignados'}</p><div className="weekly-task-form"><div className="week-task-top"><label>Hora <b>*</b><input type="time" min={hours.min} max={hours.max} value={task.time} onChange={event => updateTask(day, teamIndex, taskIndex, { time: event.target.value })} /></label><label>Tipo de servicio <b>*</b><select value={serviceForWeeklyTask(task)?.id || ''} onChange={event => selectWeeklyService(day, teamIndex, taskIndex, event.target.value)}><option value="">Seleccionar</option>{activeServices.map(service => <option key={service.id} value={service.id}>{service.name}</option>)}</select></label></div><label>Cliente o cuenta <b>*</b><input list={customerListId} placeholder="Buscá por nombre o cuenta" value={task.client} onChange={event => selectCustomer(day, teamIndex, taskIndex, event.target.value)} /></label><datalist id={customerListId}>{customers.map(customer => <option key={customer.account} value={`${customer.account} ${customer.name}`} />)}</datalist><label>Dirección <b>*</b><input value={task.address} onChange={event => updateTask(day, teamIndex, taskIndex, { address: event.target.value })} /></label><label>Contacto<input value={task.phone} onChange={event => updateTask(day, teamIndex, taskIndex, { phone: event.target.value })} /></label><label>Detalle <b>*</b><textarea value={task.detail} onChange={event => updateTask(day, teamIndex, taskIndex, { detail: event.target.value })} /></label><div className="weekly-extra-fields"><label>Forma de pago<input value={task.paymentMethod} onChange={event => updateTask(day, teamIndex, taskIndex, { paymentMethod: event.target.value })} /></label><label>Abono mensual<input value={task.monthlyFee} onChange={event => updateTask(day, teamIndex, taskIndex, { monthlyFee: event.target.value })} /></label><label>Formulario<input value={task.form} onChange={event => updateTask(day, teamIndex, taskIndex, { form: event.target.value })} /></label></div></div><div className="modal-actions"><button className="secondary" onClick={() => setTaskEditor(null)}>Cancelar</button><button className="primary" onClick={() => { setTaskEditor(null); setNotice(`Servicio ${taskIndex + 1} actualizado.`) }}><Icon name="check" size={16} />Guardar servicio</button></div></section></div>
    })()}
    <div className="weekly-scroll-top" ref={weeklyTopScrollRef} tabIndex={0} aria-label="Desplazamiento horizontal superior" onScroll={event => syncWeeklyScroll(event.currentTarget, weeklyBoardRef.current)}><div style={{ width: `${weeklyScrollWidth}px` }} /></div>
    <div className="weekly-board" ref={weeklyBoardRef} onScroll={event => syncWeeklyScroll(event.currentTarget, weeklyTopScrollRef.current)}>
      {days.map(day => {
        const plan = dayPlan(day)
        const hours = hoursForDay(day)
        const conflicts = conflictsForDay(day)
        return <section className={`week-day ${!hours ? 'closed-day' : ''}`} data-day={day} key={day}>
          <header><div><b>{displayDate(day)}</b><small>{!hours ? 'No operativo' : day === today ? 'Hoy' : prettyDate(day)}</small></div><button className="secondary small" disabled={!hours} onClick={() => openDay(day)}>Abrir día</button></header>
          {!hours ? <p className="closed-day-note">Domingo · sin programación</p> : <>
            <small className="weekly-hours">Horario habilitado: {hours.label}</small>
            {conflicts.length > 0 && <p className="weekly-conflict">Conflicto: {conflicts.map(item => `${item.name} ${item.time}`).join(', ')}</p>}
            <div className="week-teams">{plan.teams.map((team, teamIndex) => {
              const pickerKey = `${day}-${teamIndex}`
              return <article className="week-team" key={team.teamId || teamIndex}>
                <div className="week-team-header"><div className="week-team-identity"><strong>{team.label || `Equipo ${teamIndex + 1}`}</strong><span title={team.members?.join(' · ') || 'Sin técnicos'}>{team.members?.length ? team.members.map(weeklyTechnicianName).join(' · ') : 'Sin técnicos'}</span></div><div className="weekly-team-actions">{plan.teams.length > 1 && <button className="weekly-remove-team" title="Quitar equipo" aria-label={`Quitar ${team.label || `Equipo ${teamIndex + 1}`}`} onClick={() => setTeamRemoval({ day, teamIndex, label: team.label || `Equipo ${teamIndex + 1}` })}><Icon name="trash" size={15} /></button>}<div className="weekly-technicians-picker"><button className="secondary small weekly-add-tech-button" title="Agregar técnicos" aria-label="Agregar técnicos" onClick={() => { setTechPicker(techPicker === pickerKey ? null : pickerKey); setTechFilter('') }}><Icon name="users" size={16} /><span aria-hidden="true">+</span></button>{techPicker === pickerKey && <div className="tech-popover weekly-tech-popover"><div className="weekly-tech-popover-title"><div><strong>Asignar técnicos</strong><small>{team.label || `Equipo ${teamIndex + 1}`}</small></div><span>{team.members?.length || 0} seleccionados</span></div><input autoFocus placeholder="Buscar técnico..." value={techFilter} onChange={event => setTechFilter(event.target.value)} /><div className="tech-list">{activeTechs.filter(tech => tech.name.toLowerCase().includes(techFilter.toLowerCase())).map(tech => <label key={tech.id} title={tech.name}><input type="checkbox" checked={(team.members || []).includes(tech.name)} onChange={() => toggleWeeklyTech(day, teamIndex, tech.name)} />{tech.firstName || tech.name.split(' ')[0]}</label>)}{!activeTechs.length && <p>No hay técnicos activos.</p>}</div></div>}</div></div></div>
                {team.tasks.map((task, taskIndex) => <div className={`week-task week-task-summary ${!task.client ? 'available-slot' : ''}`} key={taskIndex} role="button" tabIndex={0} onClick={() => setTaskEditor({ day, teamIndex, taskIndex })} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setTaskEditor({ day, teamIndex, taskIndex }) } }}>
                  <div className="week-task-title"><span>Servicio {taskIndex + 1}</span><small>{task.time || '--:--'} Hs</small></div><strong className="week-task-client">{task.client || 'Disponible'}</strong>
                  <div className="week-task-top"><label>Hora <b>*</b><input type="time" min={hours.min} max={hours.max} value={task.time} onChange={event => updateTask(day, teamIndex, taskIndex, { time: event.target.value })} /></label><label>Tipo de servicio <b>*</b><select value={serviceForWeeklyTask(task)?.id || ''} onChange={event => selectWeeklyService(day, teamIndex, taskIndex, event.target.value)}><option value="">Seleccionar</option>{activeServices.map(service => <option key={service.id} value={service.id}>{service.name}</option>)}</select></label></div>
                  <label>Cliente o cuenta <b>*</b><input list={`weekly-customers-${day}`} placeholder="Buscá por nombre o cuenta" value={task.client} onChange={event => selectCustomer(day, teamIndex, taskIndex, event.target.value)} /></label><datalist id={`weekly-customers-${day}`}>{customers.map(customer => <option key={customer.account} value={`${customer.account} ${customer.name}`} />)}</datalist>
                  <label>Dirección <b>*</b><input value={task.address} onChange={event => updateTask(day, teamIndex, taskIndex, { address: event.target.value })} /></label>
                  <label>Contacto<input value={task.phone} onChange={event => updateTask(day, teamIndex, taskIndex, { phone: event.target.value })} /></label>
                  <label>Detalle <b>*</b><textarea value={task.detail} onChange={event => updateTask(day, teamIndex, taskIndex, { detail: event.target.value })} /></label>
                  <div className="weekly-extra-fields"><label>Forma de pago<input value={task.paymentMethod} onChange={event => updateTask(day, teamIndex, taskIndex, { paymentMethod: event.target.value })} /></label><label>Abono mensual<input value={task.monthlyFee} onChange={event => updateTask(day, teamIndex, taskIndex, { monthlyFee: event.target.value })} /></label><label>Formulario<input value={task.form} onChange={event => updateTask(day, teamIndex, taskIndex, { form: event.target.value })} /></label></div>
                </div>)}
                <button className="weekly-add-task" onClick={() => addTask(day, teamIndex)}><Icon name="plus" size={15} />Agregar servicio</button>
              </article>
            })}</div>
            <button className="weekly-add-team" onClick={() => addTeam(day)}><Icon name="plus" size={16} />Agregar otro equipo</button>
          </>}
        </section>
      })}
    </div>
  </>
}

function Dashboard({ history, services }) {
  return <DashboardView history={history} services={services} />
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7))
  const records = history.filter(record => record.date?.startsWith(month)).sort((a, b) => b.date.localeCompare(a.date))
  const installations = records.filter(record => record.service?.toLowerCase().includes('instalación'))
  const alarms = installations.filter(record => record.service?.toLowerCase().includes('alarma'))
  const byZone = category => alarms.filter(record => { const address = `${record.address || ''} ${record.client || ''}`.toLowerCase(); return category === 'docta' ? address.includes('docta') : category === 'nobu' ? address.includes('nobu') : !address.includes('docta') && !address.includes('nobu') })
  const zones = [['docta', 'Docta Urbanización'], ['nobu', 'Nobu'], ['otros', 'Otros barrios']]
  const download = category => window.location.assign(`/api/history/export?month=${encodeURIComponent(month)}&category=${category}`)
  return <><div className="module-intro"><div><p className="eyebrow">RESUMEN GERENCIAL</p><h1>Indicadores operativos</h1><p>Seguimiento mensual de instalaciones y exportación de reportes de alarmas.</p></div><label className="month-filter">Mes de análisis<input type="month" value={month} onChange={event => setMonth(event.target.value)} /></label></div><div className="stats-grid"><article><span>Instalaciones del mes</span><b>{installations.length}</b><small>Todos los tipos de instalación</small></article><article><span>Instalaciones de alarma</span><b>{alarms.length}</b><small>Servicios registrados en el período</small></article><article><span>Trabajos totales</span><b>{records.length}</b><small>Instalaciones y servicios técnicos</small></article></div><div className="module-intro dashboard-subtitle"><div><p className="eyebrow">INSTALACIONES DE ALARMA</p><h2>Detalle por ubicación</h2></div></div><div className="zone-grid">{zones.map(([key, label]) => <article className="data-card" key={key}><p>{label}</p><b>{byZone(key).length}</b><span>instalaciones de alarma</span><button className="secondary" onClick={() => download(key)}><Icon name="upload" size={16} />Descargar Excel</button></article>)}</div><div className="data-card dashboard-list"><div className="table-head"><span>Últimos trabajos del período</span><span>Cliente</span><span>Servicio</span><span>Técnicos</span></div>{records.slice(0, 8).map(record => <div className="dashboard-row" key={record.id}><span>{prettyDate(record.date)}</span><b>{record.client}</b><span>{record.service}</span><span>{record.technicians?.join(' / ') || 'Sin asignar'}</span></div>)}{!records.length && <div className="empty-state">No hay trabajos registrados para el mes seleccionado.</div>}</div></>
}

function DashboardView({ history, services }) {
  return <DashboardStatusView history={history} services={services} />
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7))
  const year = month.slice(0, 4)
  const records = history.filter(record => record.date?.startsWith(month)).sort((a, b) => b.date.localeCompare(a.date))
  const installations = records.filter(record => record.service?.toLowerCase().includes('instalación'))
  const alarms = installations.filter(record => record.service?.toLowerCase().includes('alarma'))
  const zoneOf = record => record.installationZone || (`${record.address || ''} ${record.client || ''}`.toLowerCase().includes('docta') ? 'docta' : `${record.address || ''} ${record.client || ''}`.toLowerCase().includes('nobu') ? 'nobu-town' : 'residencial')
  const zones = [['docta', 'Docta Urbanización'], ['nobu-town', 'Nobu Town'], ['residencial', 'Residenciales']]
  const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'].map((label, index) => ({ label, value: history.filter(record => record.date?.startsWith(`${year}-${String(index + 1).padStart(2, '0')}`) && record.service?.toLowerCase().includes('instalación de alarma')).length }))
  const max = Math.max(1, ...months.map(item => item.value))
  const download = category => window.location.assign(`/api/history/export?month=${encodeURIComponent(month)}&category=${category}`)
  return <><div className="module-intro"><div><p className="eyebrow">RESUMEN GERENCIAL</p><h1>Indicadores operativos</h1><p>Seguimiento mensual de instalaciones y reportes de alarmas.</p></div><label className="month-filter">Mes de análisis<input type="month" value={month} onChange={event => setMonth(event.target.value)} /></label></div><div className="stats-grid"><article><span>Instalaciones del mes</span><b>{installations.length}</b><small>Todos los tipos de instalación</small></article><article><span>Instalaciones de alarma</span><b>{alarms.length}</b><small>Servicios registrados en el período</small></article><article><span>Trabajos totales</span><b>{records.length}</b><small>Instalaciones y servicios técnicos</small></article></div><div className="dashboard-analytics"><article className="data-card annual-chart"><div><p className="eyebrow">EVOLUCIÓN ANUAL</p><h2>Instalaciones de alarma · {year}</h2></div><div className="bar-chart">{months.map(item => <div className="bar-item" key={item.label}><span>{item.value}</span><i style={{ height: `${Math.max(4, item.value / max * 100)}%` }}></i><small>{item.label}</small></div>)}</div></article><article className="data-card zone-summary"><p className="eyebrow">INSTALACIONES DE ALARMA</p><h2>Detalle por ubicación</h2>{zones.map(([key, label]) => <div key={key}><span>{label}</span><b>{alarms.filter(record => zoneOf(record) === key).length}</b><button className="secondary" onClick={() => download(key)}><Icon name="upload" size={15} />Excel</button></div>)}</article></div><div className="data-card dashboard-list"><div className="table-head"><span>Últimos trabajos del período</span><span>Cliente</span><span>Servicio</span><span>Técnicos</span></div>{records.slice(0, 8).map(record => <div className="dashboard-row" key={record.id}><span>{prettyDate(record.date)}</span><b>{record.client}</b><span>{record.service}</span><span>{record.technicians?.join(' / ') || 'Sin asignar'}</span></div>)}{!records.length && <div className="empty-state">No hay trabajos registrados para el mes seleccionado.</div>}</div></>
}

/** Vista restringida: un técnico sólo informa el resultado de sus servicios asignados. */
/** Registro de trazabilidad exclusivo para las acciones revisadas por Administración. */
function AuditShell({ user, onNavigate, logout }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const navigation = [['dashboard', 'dashboard', 'Menú principal'], ['agenda', 'agenda', 'Agenda técnica'], ['history', 'history', 'Historial'], ['accounts', 'accounts', 'Abonados y clientes'], ['employees', 'users', 'Empleados'], ['services', 'tools', 'Tipo de servicio'], ['settings', 'settings', 'Configuración'], ['audit', 'audit', 'Auditoría'], ['reviews', 'reviews', 'Reseñas']]
  return <div className="audit-shell"><aside className={`sidebar audit-sidebar ${menuOpen ? 'open' : ''}`}><button className="audit-sidebar-brand" onClick={() => onNavigate('dashboard')} title="Ir al menú principal"><img src="/logo-pignus.png" alt="Pignus" /></button><p className="nav-label">MÓDULOS</p><nav>{navigation.map(([id, icon, label]) => <button key={id} className={id === 'audit' ? 'active' : ''} onClick={() => { onNavigate(id); setMenuOpen(false) }}><Icon name={icon} />{label}</button>)}</nav><div className="sidebar-bottom">v1.1 · Agenda técnica</div></aside>{menuOpen && <button className="backdrop" aria-label="Cerrar menú" onClick={() => setMenuOpen(false)} />}<AuditPage user={user} onBack={() => onNavigate('dashboard')} onOpenMenu={() => setMenuOpen(true)} logout={logout} /></div>
}

function AuditPage({ user, onBack, onOpenMenu, logout }) {
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [action, setAction] = useState('')
  const [selected, setSelected] = useState(null)
  const [confirmLogout, setConfirmLogout] = useState(false)
  const loadAudit = () => { setLoading(true); fetch('/api/audit?limit=800', { cache: 'no-store' }).then(response => response.ok ? response.json() : Promise.reject()).then(data => { setRecords(Array.isArray(data.records) ? data.records : []); setError('') }).catch(() => setError('No se pudo cargar el registro de auditoría.')).finally(() => setLoading(false)) }
  useEffect(loadAudit, [])
  const normalized = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const escapeAuditHtml = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  // Resalta las propiedades cuyo valor no coincide entre la versión anterior y la nueva.
  const auditJsonMarkup = (value, comparison, tone) => {
    if (!value) return 'No aplica.'
    const changedKeys = value && comparison && typeof value === 'object' && typeof comparison === 'object'
      ? new Set([...Object.keys(value), ...Object.keys(comparison)].filter(key => JSON.stringify(value[key]) !== JSON.stringify(comparison[key])))
      : new Set()
    return JSON.stringify(value, null, 2).split('\n').map(line => {
      const match = line.match(/^\s*"([^\"]+)":/)
      const changed = match && changedKeys.has(match[1])
      return changed ? `<span class="audit-change audit-change-${tone}">${escapeAuditHtml(line)}</span>` : escapeAuditHtml(line)
    }).join('\n')
  }
  useEffect(() => {
    if (!selected) return undefined
    const panes = document.querySelectorAll('.audit-diff pre')
    if (panes.length !== 2) return undefined
    panes[0].innerHTML = auditJsonMarkup(selected.before, selected.after, 'before')
    panes[1].innerHTML = auditJsonMarkup(selected.after, selected.before, 'after')
    return undefined
  }, [selected])
  const visible = useMemo(() => records.filter(record => (!action || record.action === action) && normalized([record.user?.name, record.user?.email, record.entity, record.entityId, record.action].join(' ')).includes(normalized(query))), [records, action, query])
  const actionClass = value => normalized(value).includes('elimino') ? 'audit-delete' : normalized(value).includes('creo') ? 'audit-create' : normalized(value).includes('modifico') ? 'audit-edit' : 'audit-status'
  return <main className="audit-page"><header className="audit-topbar"><button className="mobile-menu audit-mobile-menu" onClick={onOpenMenu}><Icon name="menu" /></button><button className="audit-brand" onClick={onBack} title="Volver al menú principal"><img src="/logo-pignus.png" alt="Pignus" /></button><div><b>Auditoría</b><span>Registro de actividad del sistema</span></div><div className="audit-user"><span>{user.name}</span><small>{user.email}</small></div><button className="secondary small" onClick={onBack}>Volver al menú</button><button className="logout-button" onClick={() => setConfirmLogout(true)}><Icon name="logout" size={17} />Cerrar sesión</button></header><section className="audit-content"><div className="module-intro"><div><p className="eyebrow">CONTROL Y TRAZABILIDAD</p><h1>Auditoría del sistema</h1><p>Consultá quién creó, modificó, eliminó o informó cambios, con fecha y detalle de cada acción.</p></div><button className="secondary" onClick={loadAudit}><Icon name="history" />Actualizar</button></div><div className="audit-filters"><label>Acción<select value={action} onChange={event => setAction(event.target.value)}><option value="">Todas las acciones</option>{[...new Set(records.map(record => record.action))].map(item => <option key={item} value={item}>{item}</option>)}</select></label><label className="audit-search">Buscar usuario, entidad o registro<input value={query} onChange={event => setQuery(event.target.value)} placeholder="Ej.: Leonardo, cliente o PIG-6375" /></label><span><b>{visible.length}</b> acciones registradas</span></div>{error && <div className="notice audit-error">{error}</div>}<div className="audit-table"><div className="audit-table-head"><span>Fecha y hora</span><span>Usuario</span><span>Acción</span><span>Información afectada</span><span>Detalle</span></div>{loading ? <div className="empty-state">Cargando registro de auditoría…</div> : visible.map(record => <div className="audit-row" key={record.id}><span>{prettyReportDateTime(record.at)}</span><span><b>{record.user?.name || 'Usuario desconocido'}</b><small>{record.user?.email}</small></span><span><i className={actionClass(record.action)}>{record.action}</i></span><span><b>{record.entity}</b><small>{record.entityId}</small></span><button className="secondary small" onClick={() => setSelected(record)}><Icon name="eye" size={16} />Ver detalle</button></div>)}{!loading && !visible.length && <div className="empty-state">No hay acciones que coincidan con los filtros seleccionados.</div>}</div></section>{selected && <div className="modal-layer"><div className="modal audit-modal"><button className="modal-close" onClick={() => setSelected(null)}><Icon name="close" /></button><p className="eyebrow">DETALLE DE AUDITORÍA</p><h2>{selected.action} · {selected.entity}</h2><div className="audit-detail-meta"><span><b>Usuario</b>{selected.user?.name} · {selected.user?.email}</span><span><b>Fecha y hora</b>{prettyReportDateTime(selected.at)}</span><span><b>Registro</b>{selected.entityId}</span></div><div className="audit-diff"><section><h3>Antes</h3><pre>{selected.before ? JSON.stringify(selected.before, null, 2) : 'No aplica: es un registro nuevo.'}</pre></section><section><h3>Después</h3><pre>{selected.after ? JSON.stringify(selected.after, null, 2) : 'No aplica: el registro fue eliminado.'}</pre></section></div></div></div>}{confirmLogout && <Confirm title="Cerrar sesión" detail="¿Querés cerrar sesión? Tendrás que volver a ingresar con tus credenciales para acceder al sistema." action={logout} confirmLabel="Sí, cerrar sesión" close={() => setConfirmLogout(false)} />}</main>
}

function TechnicianPortal({ user, history, setHistory, logout }) {
  const [draft, setDraft] = useState(null)
  const [observation, setObservation] = useState('')
  const [confirm, setConfirm] = useState(null)
  const [view, setView] = useState('agenda')
  const today = new Date().toISOString().slice(0, 10)
  const resolved = record => Boolean(record.technicalStatus || record.status === 'Completado' || record.status === 'Cancelado' || record.status === 'Reprogramado')
  const assignedServices = history.filter(record => record.technicianIds?.some(id => String(id) === String(user.id))).sort((a, b) => `${a.date}-${a.time || ''}`.localeCompare(`${b.date}-${b.time || ''}`))
  const services = (view === 'agenda' ? assignedServices.filter(record => record.date >= today && !resolved(record)) : assignedServices.filter(resolved).reverse())
  useEffect(() => {
    // Todos los integrantes de un equipo consultan el mismo registro compartido.
    // Así, al informar un estado un compañero, se retira o actualiza para los demás.
    const refreshSharedAgenda = () => {
      if (document.visibilityState === 'hidden') return
      fetch('/api/state', { cache: 'no-store' }).then(response => response.ok ? response.json() : null).then(data => { if (Array.isArray(data?.history)) setHistory(data.history) }).catch(() => {})
    }
    const interval = window.setInterval(refreshSharedAgenda, 10000)
    window.addEventListener('focus', refreshSharedAgenda)
    return () => { window.clearInterval(interval); window.removeEventListener('focus', refreshSharedAgenda) }
  }, [setHistory])
  useEffect(() => {
    const sidebar = document.createElement('aside')
    sidebar.className = 'technician-sidebar'
    sidebar.innerHTML = `<img src="/logo-pignus.png" alt="Pignus"><p>MÓDULOS</p><button data-view="agenda">▣ <span>Agenda técnica</span></button><button data-view="history">◷ <span>Historial</span></button>`
    sidebar.querySelectorAll('button').forEach(button => { button.classList.toggle('active', button.dataset.view === view); button.onclick = () => setView(button.dataset.view) })
    document.body.append(sidebar)
    return () => sidebar.remove()
  }, [view])
  useEffect(() => {
    const title = document.querySelector('.technician-content h1')
    const help = document.querySelector('.technician-help')
    if (title) title.textContent = view === 'agenda' ? 'Servicios pendientes' : 'Historial de servicios'
    if (help) help.textContent = view === 'agenda' ? 'Completá cada servicio en el orden indicado. La dirección y el contacto del siguiente se habilitan al informar el estado del actual.' : 'Consultá los servicios que ya informaste y el estado registrado en cada uno.'
  }, [view])
  useEffect(() => {
    document.querySelectorAll('.technician-service .work-status').forEach(badge => {
      badge.classList.remove('tech-status-completado', 'tech-status-cancelado', 'tech-status-reprogramacion')
      const label = badge.textContent.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
      if (label.includes('cancel')) badge.classList.add('tech-status-cancelado')
      else if (label.includes('reprogram')) badge.classList.add('tech-status-reprogramacion')
      else if (label.includes('complet')) badge.classList.add('tech-status-completado')
    })
  }, [services])
  const saveStatus = async () => {
    const { record, type } = confirm
    const response = await fetch('/api/technician/status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recordId: record.id, type, observation }) })
    const data = await response.json()
    if (!response.ok) return window.alert(data.error || 'No se pudo informar el estado.')
    setHistory(previous => previous.map(item => item.id === record.id ? data.record : item))
    setConfirm(null); setDraft(null); setObservation('')
  }
  const requestStatus = (record, type) => {
    if ((type === 'Cancelado' || type === 'Reprogramación solicitada') && !observation.trim()) return
    setConfirm({ record, type })
  }
  return <main className="technician-page"><header className="technician-header"><img src="/logo-pignus.png" alt="Pignus" /><div><b>{user.name}</b><span>{user.email}</span></div><button className="logout-button" onClick={() => setConfirm({ logout: true })}><Icon name="logout" size={17} />Cerrar sesión</button></header><section className="technician-content"><p className="eyebrow">MI AGENDA</p><h1>Servicios asignados</h1><p className="technician-help">Completá cada servicio en el orden indicado. La dirección y el contacto del siguiente se habilitan al informar el estado del actual.</p>{services.length ? services.map((record, index) => { const unlocked = index === 0 || resolved(services[index - 1]); const done = resolved(record); return <article className={`technician-service ${unlocked ? '' : 'locked'}`} key={record.id}><div className="technician-service-head"><span>{index + 1}</span><div><b>{record.time ? `${record.time} Hs` : 'Horario a confirmar'}</b><small>{prettyDate(record.date)}</small></div><em className={`work-status ${done ? 'completado' : 'pendiente'}`}>{record.technicalStatus || record.status || 'Pendiente'}</em></div><h2>{record.service}</h2><p className="tech-client">{record.client}</p><p><b>Detalle:</b> {record.detail || 'Sin observaciones'}</p>{unlocked ? <><p><b>Dirección:</b> {record.address || 'Sin dirección'}</p><p><b>Contacto:</b> {record.phone || 'Sin contacto'}</p></> : <p className="locked-info">La dirección y el contacto se habilitarán al informar el estado del servicio anterior.</p>}{unlocked && !done && <div className="technician-actions"><button className="primary" onClick={() => { setDraft({ record, type: 'Completado' }); setObservation('') }}><Icon name="check" />Marcar completado</button><button className="secondary" onClick={() => { setDraft({ record, type: 'Reprogramación solicitada' }); setObservation('') }}>Solicitar reprogramación</button><button className="secondary" onClick={() => { setDraft({ record, type: 'Cancelado' }); setObservation('') }}>Informar cancelación</button></div>}{done && record.technicalReportedAt && <small className="reported-at">Informado: {prettyReportDateTime(record.technicalReportedAt)}</small>}</article> }) : <div className="empty-state">No tenés servicios asignados pendientes para hoy o fechas futuras.</div>}</section>{draft && <div className="modal-layer"><div className="modal technician-status-modal"><button className="close-modal" onClick={() => setDraft(null)}><Icon name="close" /></button><p className="eyebrow">ACTUALIZAR SERVICIO</p><h2>{draft.type}</h2><p>{draft.record.client} · {draft.record.service}</p>{draft.type !== 'Completado' && <label>Observación obligatoria<textarea required value={observation} onChange={event => setObservation(event.target.value)} placeholder="Explicá el motivo para que Administración pueda gestionarlo." /></label>}<div className="modal-actions"><button className="secondary" onClick={() => setDraft(null)}>Cancelar</button><button className="primary" disabled={draft.type !== 'Completado' && !observation.trim()} onClick={() => setConfirm({ record: draft.record, type: draft.type })}>Continuar</button></div></div></div>}{confirm?.record && <Confirm title="Confirmar estado" detail={`¿Confirmás que querés informar “${confirm.type}”? Luego quedará registrado y cualquier cambio deberá ser revisado por Administración.`} action={saveStatus} confirmLabel="Sí, confirmar estado" close={() => setConfirm(null)} />}{confirm?.logout && <Confirm title="Cerrar sesión" detail="¿Querés cerrar sesión?" action={logout} confirmLabel="Sí, cerrar sesión" close={() => setConfirm(null)} />}</main>
}

function DashboardStatusView({ history, services }) {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7))
  const [alarmModalOpen, setAlarmModalOpen] = useState(false)
  const [retirementModalOpen, setRetirementModalOpen] = useState(false)
  const [projectionModalOpen, setProjectionModalOpen] = useState(false)
  const [workModalOpen, setWorkModalOpen] = useState(false)
  const year = month.slice(0, 4)
  const isComplete = record => record.status === 'Completado'
  const records = history.filter(record => record.date?.startsWith(month) && isComplete(record)).sort((a, b) => b.date.localeCompare(a.date))
  const pending = history.filter(record => !record.status || record.status === 'Pendiente' || record.status === 'Reprogramado' || record.status === 'Requiere revisión')
  const openPending = () => window.dispatchEvent(new Event('pignus:open-history'))
  const serviceForRecord = record => services.find(service => String(service.id) === String(record.serviceId)) || services.find(service => normalizeServiceName(service.name) === normalizeServiceName(record.service))
  const isAlarmRecord = record => serviceCode(serviceForRecord(record)) === 'alarm-installation' || (!record.serviceId && normalizeServiceName(record.service).includes('alarma'))
  const installations = records.filter(record => serviceForRecord(record)?.category === 'installation' || (!record.serviceId && normalizeServiceName(record.service).includes('instalacion')))
  const alarms = installations.filter(isAlarmRecord)
  const isRetirementRecord = record => normalizeServiceName(serviceForRecord(record)?.name || record.service).includes('retiro')
  const retirements = records.filter(isRetirementRecord)
  const netGrowth = alarms.length - retirements.length
  const zoneOf = record => record.installationZone || (`${record.address || ''} ${record.client || ''}`.toLowerCase().includes('docta') ? 'docta' : `${record.address || ''} ${record.client || ''}`.toLowerCase().includes('nobu') ? 'nobu-town' : 'residencial')
  const zones = [['docta', 'Docta Urbanización'], ['nobu-town', 'Nobu Town'], ['residencial', 'Residenciales']]
  const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'].map((label, index) => {
    const monthKey = `${year}-${String(index + 1).padStart(2, '0')}`
    return {
      label,
      value: history.filter(record => record.date?.startsWith(monthKey) && isComplete(record) && isAlarmRecord(record)).length,
      retirements: history.filter(record => record.date?.startsWith(monthKey) && isComplete(record) && isRetirementRecord(record)).length
    }
  })
  const max = Math.max(1, ...months.flatMap(item => [item.value, item.retirements]))
  useEffect(() => {
    const chart = document.querySelector('.annual-chart .bar-chart')
    if (!chart) return undefined
    chart.parentElement.querySelector('.chart-legend')?.remove()
    const legend = document.createElement('div')
    legend.className = 'chart-legend'
    legend.innerHTML = '<span><i class="legend-highs"></i>Altas</span><span><i class="legend-lows"></i>Bajas</span>'
    chart.before(legend)
    chart.querySelectorAll('.bar-item').forEach((item, index) => {
      item.querySelector('.bar-retirements')?.remove()
      item.querySelector('.retirement-value')?.remove()
      item.querySelector(':scope > i')?.classList.add('bar-installations')
      const retirements = months[index]?.retirements || 0
      const bar = document.createElement('i')
      bar.className = 'bar-retirements'
      bar.style.height = `${Math.max(retirements ? 4 : 0, retirements / max * 100)}%`
      bar.title = `${retirements} baja${retirements === 1 ? '' : 's'}`
      item.append(bar)
      const value = document.createElement('span')
      value.className = 'retirement-value'
      value.textContent = retirements
      value.style.bottom = `calc(${Math.max(retirements ? 4 : 0, retirements / max * 100)}% + 22px)`
      item.append(value)
    })
    return () => { legend.remove(); chart.querySelectorAll('.bar-retirements, .retirement-value').forEach(element => element.remove()) }
  }, [months.map(item => `${item.value}:${item.retirements}`).join('|'), max])
  const download = category => window.location.assign(`/api/history/export?month=${encodeURIComponent(month)}&category=${category}`)
  const serviceBreakdown = Object.entries(records.reduce((summary, record) => { const name = record.service?.trim() || 'Sin especificar'; summary[name] = (summary[name] || 0) + 1; return summary }, {})).sort(([, left], [, right]) => right - left)
  const [selectedYear, selectedMonth] = month.split('-').map(Number)
  const daysInPeriod = new Date(selectedYear, selectedMonth, 0).getDate()
  const today = new Date()
  const isCurrentPeriod = today.getFullYear() === selectedYear && today.getMonth() + 1 === selectedMonth
  const elapsedDays = isCurrentPeriod ? today.getDate() : daysInPeriod
  const projectedInstallations = elapsedDays ? Math.round(netGrowth / elapsedDays * daysInPeriod) : 0
  const previousDate = new Date(selectedYear, selectedMonth - 2, 1)
  const previousMonthKey = `${previousDate.getFullYear()}-${String(previousDate.getMonth() + 1).padStart(2, '0')}`
  const previousInstallations = history.filter(record => record.date?.startsWith(previousMonthKey) && isComplete(record) && isAlarmRecord(record)).length
  const previousRetirements = history.filter(record => record.date?.startsWith(previousMonthKey) && isComplete(record) && isRetirementRecord(record)).length
  const previousNetGrowth = previousInstallations - previousRetirements
  const comparisonValue = isCurrentPeriod ? projectedInstallations : netGrowth
  const variation = previousNetGrowth ? Math.round((comparisonValue - previousNetGrowth) / Math.abs(previousNetGrowth) * 100) : null
  const previousMonthLabel = previousDate.toLocaleDateString('es-AR', { month: 'long' })
  const yearToDateInstallations = history.filter(record => record.date?.startsWith(`${selectedYear}-`) && Number(record.date.slice(5, 7)) <= selectedMonth && isComplete(record) && isAlarmRecord(record)).length
  const yearToDateRetirements = history.filter(record => record.date?.startsWith(`${selectedYear}-`) && Number(record.date.slice(5, 7)) <= selectedMonth && isComplete(record) && isRetirementRecord(record)).length
  const averageInstallations = (yearToDateInstallations - yearToDateRetirements) / selectedMonth
  const averageValue = Math.round(averageInstallations)
  const averageVariation = averageInstallations ? Math.round((comparisonValue - averageInstallations) / averageInstallations * 100) : null
  useEffect(() => {
    const stats = document.querySelector('.stats-grid')
    if (!stats) return
    const cards = [...stats.querySelectorAll(':scope > article')]
    const projectionCard = cards.find(card => {
      const title = card.querySelector('span')?.textContent || ''
      return title.includes('Instalaciones') || title.includes('Proyección') || title.includes('Crecimiento neto')
    })
    const alarmsCard = cards.find(card => card.querySelector('span')?.textContent.includes('Altas'))
    if (!projectionCard || !alarmsCard) return
    stats.prepend(alarmsCard)
    projectionCard.querySelector('span').textContent = isCurrentPeriod ? 'Crecimiento neto del mes' : 'Crecimiento neto del período'
    projectionCard.querySelector('b').textContent = `${netGrowth > 0 ? '+' : ''}${netGrowth}`
    const comparison = variation === null ? `Sin crecimiento neto comparable en ${previousMonthLabel}` : `<strong class="projection-variation ${variation >= 0 ? 'positive' : 'negative'}">${variation > 0 ? '+' : ''}${variation}%</strong> vs. ${previousMonthLabel}`
    const averageComparison = averageVariation === null ? 'Sin promedio neto anual disponible' : `<strong class="projection-variation ${averageVariation >= 0 ? 'positive' : 'negative'}">${averageVariation > 0 ? '+' : ''}${averageVariation}%</strong> vs. promedio neto mensual ${selectedYear} (${averageValue})`
    projectionCard.querySelector('small').innerHTML = isCurrentPeriod
      ? `<span>${variation === null ? `Sin comparación disponible vs. ${previousMonthLabel}` : `<strong class="projection-variation ${variation >= 0 ? 'positive' : 'negative'}">${variation > 0 ? '+' : ''}${variation}%</strong> vs. ${previousMonthLabel}`}</span><br><span>${averageVariation === null ? 'Sin promedio anual disponible' : `<strong class="projection-variation ${averageVariation >= 0 ? 'positive' : 'negative'}">${averageVariation > 0 ? '+' : ''}${averageVariation}%</strong> vs. promedio neto mensual ${selectedYear} (${averageValue})`}</span>`
      : 'Resultado final del período'
  }, [month, netGrowth, isCurrentPeriod, variation, averageVariation, previousMonthLabel, selectedYear, averageValue])
  useEffect(() => {
    // Las tarjetas se vuelven accesibles por mouse y teclado una vez ordenadas por el resumen.
    const stats = document.querySelector('.stats-grid')
    if (!stats) return undefined
    const cards = [...stats.querySelectorAll(':scope > article')]
    const projectionCard = cards.find(card => {
      const title = card.querySelector('span')?.textContent || ''
      return title.includes('Proyección') || title.includes('Crecimiento neto')
    })
    const workCard = cards.find(card => card.querySelector('span')?.textContent.includes('Trabajos'))
    const bind = (card, open, label) => {
      if (!card) return () => {}
      card.classList.add('clickable-stat')
      card.setAttribute('role', 'button'); card.tabIndex = 0; card.setAttribute('aria-label', label)
      const keyboard = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open() } }
      card.addEventListener('click', open); card.addEventListener('keydown', keyboard)
      return () => { card.removeEventListener('click', open); card.removeEventListener('keydown', keyboard) }
    }
    const unbindProjection = bind(projectionCard, () => setProjectionModalOpen(true), 'Ver detalle de proyección de alarmas')
    const unbindWorks = bind(workCard, () => setWorkModalOpen(true), 'Ver composición de trabajos completados')
    return () => { unbindProjection(); unbindWorks() }
  }, [month, projectedInstallations, records.length])
  useEffect(() => {
    if (!projectionModalOpen) return undefined
    const monthName = new Date(`${month}-01T12:00:00`).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })
    const dailyAverage = elapsedDays ? (netGrowth / elapsedDays).toFixed(1).replace('.', ',') : '0'
    const progress = projectedInstallations > 0 ? Math.min(100, Math.round(Math.max(0, netGrowth) / projectedInstallations * 100)) : 0
    const layer = document.createElement('div'); layer.className = 'modal-layer dashboard-insight-layer'
    const modal = document.createElement('div'); modal.className = 'modal dashboard-insight-modal projection-insight-modal'
    modal.innerHTML = `<button class="close-modal" aria-label="Cerrar">×</button><p class="eyebrow">PROYECCIÓN NETA DE ABONADOS</p><h2>${isCurrentPeriod ? 'Crecimiento estimado al cierre' : 'Resultado neto del período'}</h2><p class="insight-period">${monthName}</p><div class="projection-highlight"><b>${projectedInstallations}</b><span>${isCurrentPeriod ? 'crecimiento neto proyectado' : 'crecimiento neto confirmado'}</span></div><div class="projection-progress"><span style="width:${progress}%"></span></div><p class="projection-progress-label">Crecimiento actual: ${alarms.length} altas menos ${retirements.length} bajas = ${netGrowth}</p><div class="insight-metrics"><article><b>${alarms.length}</b><span>Nuevas alarmas</span></article><article><b>${retirements.length}</b><span>Bajas de servicio</span></article><article><b>${dailyAverage}</b><span>Promedio neto diario</span></article><article><b class="${variation === null || variation >= 0 ? 'positive' : 'negative'}">${variation === null ? '—' : `${variation > 0 ? '+' : ''}${variation}%`}</b><span>Vs. crecimiento neto de ${previousMonthLabel}</span></article></div><div class="modal-actions"><button class="primary">Cerrar</button></div>`
    const close = () => setProjectionModalOpen(false)
    modal.querySelectorAll('button').forEach(button => { button.onclick = close })
    layer.onclick = event => { if (event.target === layer) close() }
    layer.append(modal); document.body.append(layer)
    return () => layer.remove()
  }, [projectionModalOpen, month, alarms.length, retirements.length, netGrowth, projectedInstallations, elapsedDays, daysInPeriod, variation, previousMonthLabel, isCurrentPeriod])
  useEffect(() => {
    if (!workModalOpen) return undefined
    const palette = ['#2f69ad', '#218857', '#c4870a', '#8a57b6', '#c4534b', '#257c82', '#a76424', '#68786d']
    const total = Math.max(1, records.length)
    let offset = 0
    const slices = serviceBreakdown.map(([name, count], index) => {
      const start = offset; offset += count / total * 100
      return `${palette[index % palette.length]} ${start}% ${offset}%`
    }).join(', ')
    const monthName = new Date(`${month}-01T12:00:00`).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })
    const layer = document.createElement('div'); layer.className = 'modal-layer dashboard-insight-layer'
    const modal = document.createElement('div'); modal.className = 'modal dashboard-insight-modal work-insight-modal'
    modal.innerHTML = `<button class="close-modal" aria-label="Cerrar">×</button><p class="eyebrow">TRABAJOS COMPLETADOS</p><h2>Composición del período</h2><p class="insight-period">${records.length} trabajo(s) completado(s) en ${monthName}</p><div class="work-composition"><div class="donut-chart"><span>${records.length}<small>total</small></span></div><div class="donut-legend"></div></div><div class="modal-actions"><button class="primary">Cerrar</button></div>`
    modal.querySelector('.donut-chart').style.background = `conic-gradient(${slices || '#dfe7df 0 100%'})`
    const legend = modal.querySelector('.donut-legend')
    serviceBreakdown.forEach(([name, count], index) => {
      const row = document.createElement('div')
      const marker = document.createElement('i'); marker.style.background = palette[index % palette.length]
      const label = document.createElement('span'); label.textContent = name
      const value = document.createElement('b'); value.textContent = `${count} `
      const percentLabel = document.createElement('small'); percentLabel.textContent = `${Math.round(count / total * 100)}%`
      value.append(percentLabel); row.append(marker, label, value); legend.append(row)
    })
    if (!serviceBreakdown.length) legend.textContent = 'No hay trabajos completados para este período.'
    const close = () => setWorkModalOpen(false)
    modal.querySelectorAll('button').forEach(button => { button.onclick = close })
    layer.onclick = event => { if (event.target === layer) close() }
    layer.append(modal); document.body.append(layer)
    return () => layer.remove()
  }, [workModalOpen, month, records.length, serviceBreakdown])
  return <><div className="module-intro"><div><p className="eyebrow">RESUMEN GERENCIAL</p><h1>Indicadores operativos</h1><p>Las métricas contabilizan únicamente servicios completados.</p></div><label className="month-filter">Mes de análisis<input type="month" value={month} onChange={event => setMonth(event.target.value)} /></label></div>{pending.length > 0 && <button className="pending-reminder" type="button" onClick={openPending}><Icon name="calendar" /><div><b>{pending.length} servicio(s) pendiente(s) de definición</b><span>Revisalos en Historial para completarlos, cancelarlos o reprogramarlos.</span></div></button>}<div className="stats-grid dashboard-stats-four"><article className="clickable-stat" role="button" tabIndex={0} onClick={() => setAlarmModalOpen(true)} onKeyDown={event => event.key === 'Enter' && setAlarmModalOpen(true)}><span>Altas de servicio</span><b>{alarms.length}</b><small>Instalaciones de alarmas completadas</small></article><article className="clickable-stat retirement-stat" role="button" tabIndex={0} onClick={() => setRetirementModalOpen(true)} onKeyDown={event => event.key === 'Enter' && setRetirementModalOpen(true)}><span>Bajas de servicio</span><b>{retirements.length}</b><small>Retiros de alarmas completados</small></article><article><span>Proyección neta de abonados</span><b>{projectedInstallations}</b><small>{isCurrentPeriod ? 'Estimación al cierre' : 'Resultado final'} · altas ({alarms.length}) menos bajas ({retirements.length})</small></article><article><span>Trabajos completados</span><b>{records.length}</b><small>Instalaciones y servicios técnicos</small></article></div><div className="dashboard-analytics"><article className="data-card annual-chart"><div><p className="eyebrow">EVOLUCIÓN ANUAL</p><h2>Instalaciones de alarma · {year}</h2></div><div className="bar-chart">{months.map(item => <div className="bar-item" key={item.label}><span>{item.value}</span><i style={{ height: `${Math.max(4, item.value / max * 100)}%` }}></i><small>{item.label}</small></div>)}</div></article><article className="data-card zone-summary"><p className="eyebrow">ALTAS DE SERVICIO</p><h2>Detalle por ubicación</h2><div><span>Todas las instalaciones</span><b>{alarms.length}</b><button className="secondary all-alarms-export" onClick={() => download('all')}><Icon name="upload" size={15} />Excel</button></div>{zones.map(([key, label]) => <div key={key}><span>{label}</span><b>{alarms.filter(record => zoneOf(record) === key).length}</b><button className="secondary" onClick={() => download(key)}><Icon name="upload" size={15} />Excel</button></div>)}</article></div>{alarmModalOpen && <AlarmDetailsModal records={alarms} month={month} close={() => setAlarmModalOpen(false)} download={download} />}{retirementModalOpen && <RetirementDetailsModal records={retirements} month={month} close={() => setRetirementModalOpen(false)} />}</>
}

/** Detalle consultable de las instalaciones de alarma antes de exportar el reporte mensual. */
function AlarmDetailsModal({ records, month, close, download }) {
  const monthName = new Date(`${month}-01T12:00:00`).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })
  return <div className="modal-layer" role="dialog" aria-modal="true" aria-label="Detalle de altas de servicio"><div className="modal alarm-details-modal"><button className="close-modal" onClick={close} aria-label="Cerrar"><Icon name="close" /></button><p className="eyebrow">ALTAS DE SERVICIO</p><h2>{records.length} instalación{records.length === 1 ? '' : 'es'} de alarma en {monthName}</h2><p>Revisá la información del período o descargá el listado completo.</p><div className="alarm-details-list">{records.length ? records.map(record => <article key={record.id}><div><b>{record.client || 'Cliente sin especificar'}</b><small>{prettyDate(record.date)}{record.time ? ` · ${record.time} Hs` : ''}</small></div><div className="alarm-detail-data"><span><b>Ubicación:</b> {record.address || 'Sin dirección'}</span><span><b>Contacto:</b> {record.phone || 'Sin contacto'}</span><span><b>Técnicos:</b> {record.technicians?.join(' / ') || 'Sin asignar'}</span>{record.detail && <span><b>Detalle:</b> {record.detail}</span>}</div></article>) : <div className="empty-state">No hay instalaciones de alarma completadas para este período.</div>}</div><div className="modal-actions"><button className="secondary" onClick={() => download('all')}><Icon name="upload" size={16} />Descargar Excel completo</button><button className="primary" onClick={close}>Cerrar</button></div></div></div>
}

/** Detalle de retiros que representan bajas y reducen el crecimiento neto. */
function RetirementDetailsModal({ records, month, close }) {
  const monthName = new Date(`${month}-01T12:00:00`).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })
  return <div className="modal-layer" role="dialog" aria-modal="true" aria-label="Detalle de bajas de servicio"><div className="modal alarm-details-modal retirement-details-modal"><button className="close-modal" onClick={close} aria-label="Cerrar"><Icon name="close" /></button><p className="eyebrow">BAJAS DE SERVICIO</p><h2>{records.length} retiro{records.length === 1 ? '' : 's'} de alarma en {monthName}</h2><p>Estos registros se descuentan de las nuevas instalaciones para calcular el crecimiento neto real.</p><div className="alarm-details-list">{records.length ? records.map(record => <article key={record.id}><div><b>{record.client || 'Cliente sin especificar'}</b><small>{prettyDate(record.date)}{record.time ? ` · ${record.time} Hs` : ''}</small></div><div className="alarm-detail-data"><span><b>Servicio:</b> {record.service}</span><span><b>Dirección:</b> {record.address || 'Sin dirección'}</span><span><b>Técnicos:</b> {record.technicians?.join(' / ') || 'Sin asignar'}</span>{record.detail && <span><b>Detalle:</b> {record.detail}</span>}</div></article>) : <div className="empty-state">No hay bajas de servicio completadas para este período.</div>}</div><div className="modal-actions"><button className="primary" onClick={close}>Cerrar</button></div></div></div>
}

function History({ history, setHistory, customers, services, employees }) {
  return <HistoryView {...{ history, setHistory, customers, services, employees }} />
  const [search, setSearch] = useState('')
  const records = history.filter(record => normalizeSearchText(`${record.client} ${record.service} ${record.technicians?.join(' ')}`).includes(normalizeSearchText(search))).sort((a, b) => b.date.localeCompare(a.date))
  return <><div className="module-intro"><div><p className="eyebrow">TRABAJOS REALIZADOS</p><h1>Historial técnico</h1><p>Consultá los servicios registrados para cada cliente y el equipo asignado.</p></div></div><div className="accounts-bar history-toolbar"><div><b>{history.length}</b> trabajos registrados</div><label><Icon name="search" size={16} /><input placeholder="Buscar cliente, servicio o técnico..." value={search} onChange={event => setSearch(event.target.value)} /></label></div><div className="data-card history-table"><div className="table-head"><span>Fecha</span><span>Cliente</span><span>Servicio</span><span>Técnicos asignados</span><span>Detalle</span></div>{records.length ? records.map(record => <div className="history-row" key={record.id}><b>{prettyDate(record.date)}</b><div><strong>{record.client}</strong><small>{record.address || 'Sin dirección'}</small></div><div><em className="role-chip">{record.service}</em></div><div>{record.technicians?.length ? record.technicians.join(' / ') : 'Sin técnicos asignados'}</div><div>{record.detail || 'Sin observaciones'}</div></div>) : <div className="empty-state">Todavía no hay trabajos registrados. Al copiar una agenda, sus servicios se guardarán aquí.</div>}</div></>
}

function HistoryView({ history, setHistory, customers, services, employees }) {
  return <HistoryManagement {...{ history, setHistory, customers, services, employees }} />
  const [search, setSearch] = useState('')
  const [detail, setDetail] = useState(null)
  const records = history.filter(record => normalizeSearchText(`${record.client} ${record.service} ${record.technicians?.join(' ')}`).includes(normalizeSearchText(search))).sort((a, b) => b.date.localeCompare(a.date))
  return <><div className="module-intro"><div><p className="eyebrow">TRABAJOS REALIZADOS</p><h1>Historial técnico</h1><p>Consultá los servicios registrados para cada cliente y el equipo asignado.</p></div></div><div className="accounts-bar history-toolbar"><div><b>{history.length}</b> trabajos registrados</div><label><Icon name="search" size={16} /><input placeholder="Buscar cliente, servicio o técnico..." value={search} onChange={event => setSearch(event.target.value)} /></label></div><div className="data-card history-table"><div className="table-head"><span>Fecha</span><span>Cliente</span><span>Servicio</span><span>Técnicos asignados</span><span>Detalle</span></div>{records.length ? records.map(record => <div className="history-row" key={record.id}><b>{prettyDate(record.date)}</b><div className="history-client"><strong>{record.client}</strong><small>{record.address || 'Sin dirección'}</small></div><div><em className="role-chip">{record.service}</em></div><div>{record.technicians?.length ? record.technicians.join(' / ') : 'Sin técnicos asignados'}</div><div><button className="secondary detail-button" onClick={() => setDetail(record)}><Icon name="eye" size={16} />Ver detalle</button></div></div>) : <div className="empty-state">No hay trabajos para mostrar.</div>}</div>{detail && <HistoryDetail record={detail} close={() => setDetail(null)} />}</>
}

function HistoryBulkView({ history, setHistory, customers, services, employees }) {
  const [search, setSearch] = useState('')
  const [detail, setDetail] = useState(null)
  const [selected, setSelected] = useState([])
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false)
  const [bulkStatus, setBulkStatus] = useState('Completado')
  const [rescheduleDate, setRescheduleDate] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const minimumRescheduleDate = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' })
  const normalizedSearch = normalizeSearchText(search)
  const records = history.filter(record => normalizeSearchText(`${record.client} ${record.service} ${record.technicians?.join(' ')}`).includes(normalizedSearch) && (!fromDate || record.date >= fromDate) && (!toDate || record.date <= toDate) && (statusFilter === 'all' || (record.status || 'Pendiente') === statusFilter)).sort((a, b) => b.date.localeCompare(a.date))
  const technicianNames = record => record.technicians?.map(name => String(name).trim().split(/\s+/)[0]).filter(Boolean).join(' / ') || 'Sin asignar'
  const status = record => record.status || 'Pendiente'
  const toggle = id => setSelected(previous => previous.includes(id) ? previous.filter(item => item !== id) : [...previous, id])
  const toggleAll = () => setSelected(selected.length === records.length ? [] : records.map(record => record.id))
  const applyBulk = () => {
    if (!selected.length || (bulkStatus === 'Reprogramado' && (!rescheduleDate || rescheduleDate < minimumRescheduleDate))) return
    if (bulkStatus === 'Reprogramado') history.filter(record => selected.includes(record.id)).forEach(record => {
      window.dispatchEvent(new CustomEvent('pignus:reschedule-service', { detail: { record, nextDate: rescheduleDate } }))
    })
    setHistory(previous => previous.map(record => {
      if (!selected.includes(record.id)) return record
      // Una reprogramación mueve la visita al nuevo día para que Agenda técnica la recupere.
      if (bulkStatus === 'Reprogramado') return { ...record, date: rescheduleDate, status: 'Pendiente', scheduledDate: '', rescheduledFrom: record.date, reprogrammedAt: new Date().toISOString() }
      return { ...record, status: bulkStatus, scheduledDate: '' }
    }))
    setSelected([]); setBulkOpen(false); setRescheduleDate('')
  }
  // Eliminar en lote requiere una confirmación independiente para evitar borrados accidentales.
  const deleteSelected = () => {
    setHistory(previous => previous.filter(record => !selected.includes(record.id)))
    setSelected([])
    setBulkOpen(false)
    setBulkDeleteConfirm(false)
  }
  useEffect(() => {
    if (!bulkOpen || !selected.length) return undefined
    const actions = document.querySelector('.bulk-modal .modal-actions')
    if (!actions || actions.querySelector('.bulk-delete-button')) return undefined
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'danger-button bulk-delete-button'
    button.textContent = `Eliminar ${selected.length} registro(s)`
    button.onclick = () => setBulkDeleteConfirm(true)
    actions.prepend(button)
    return () => button.remove()
  }, [bulkOpen, selected.length])
  useEffect(() => {
    if (!bulkDeleteConfirm) return undefined
    const layer = document.createElement('div')
    layer.className = 'modal-layer bulk-delete-confirmation'
    layer.innerHTML = `<div class="modal confirm-modal"><span class="confirm-icon danger">🗑</span><h2>Eliminar registros</h2><p>¿Querés eliminar ${selected.length} servicio(s) seleccionados? Esta acción no se puede deshacer.</p><div class="confirm-actions"><button type="button" class="secondary">Cancelar</button><button type="button" class="danger-button">Sí, eliminar</button></div></div>`
    const [cancelButton, confirmButton] = layer.querySelectorAll('button')
    cancelButton.onclick = () => setBulkDeleteConfirm(false)
    confirmButton.onclick = deleteSelected
    document.body.append(layer)
    return () => layer.remove()
  }, [bulkDeleteConfirm, selected])
  useEffect(() => {
    const toolbar = document.querySelector('.history-toolbar')
    if (!toolbar) return
    const filters = document.createElement('div'); filters.className = 'history-date-filters'
    const createDateInput = (label, value, update) => { const field = document.createElement('label'); field.textContent = label; const input = document.createElement('input'); input.type = 'date'; input.value = value; input.onchange = event => update(event.target.value); field.append(input); return field }
    const statusField = document.createElement('label'); statusField.textContent = 'Estado'
    const statusSelect = document.createElement('select')
    ;[['all', 'Todos'], ['Pendiente', 'Pendiente'], ['Completado', 'Completado'], ['Requiere revisión', 'Requiere revisión'], ['Reprogramado', 'Reprogramado'], ['Cancelado', 'Cancelado']].forEach(([value, label]) => { const option = document.createElement('option'); option.value = value; option.textContent = label; statusSelect.append(option) })
    // El valor se asigna después de crear las opciones; de lo contrario el navegador
    // muestra "Todos" aunque internamente conserva el filtro anterior.
    statusSelect.value = statusFilter
    statusSelect.onchange = event => setStatusFilter(event.target.value); statusField.append(statusSelect)
    filters.append(createDateInput('Desde', fromDate, setFromDate), createDateInput('Hasta', toDate, setToDate), statusField)
    if (fromDate || toDate || statusFilter !== 'all') { const clear = document.createElement('button'); clear.type = 'button'; clear.className = 'secondary'; clear.textContent = 'Limpiar filtros'; clear.onclick = () => { setFromDate(''); setToDate(''); setStatusFilter('all') }; filters.append(clear) }
    toolbar.prepend(filters)
    return () => filters.remove()
  }, [fromDate, toDate, statusFilter])
  useEffect(() => {
    // El contador representa el resultado del filtro activo, no el total histórico.
    const counter = document.querySelector('.history-toolbar>div:not(.history-date-filters)')
    if (counter) counter.innerHTML = `<b>${records.length}</b> ${records.length === history.length ? 'trabajos registrados' : 'trabajos encontrados'}`
  }, [records.length, history.length])
  useEffect(() => {
    // El componente de historial conserva parte de su estructura legada; aplicar la clase
    // al chip ya renderizado evita duplicar la tabla y mantiene el color sincronizado al filtrar.
    const colorClasses = ['service-alarm', 'service-cameras', 'service-retirement', 'service-ownership', 'service-fence', 'service-survey', 'service-upgrade', 'service-other']
    document.querySelectorAll('.history-bulk .role-chip').forEach(chip => {
      chip.classList.remove(...colorClasses)
      chip.classList.add(serviceColorClass(chip.textContent))
    })
  }, [records])
  return <><div className="module-intro"><div><p className="eyebrow">TRABAJOS REALIZADOS</p><h1>Historial técnico</h1><p>Seleccioná varios servicios para confirmarlos, cancelarlos o reprogramarlos en una sola acción.</p></div><button className="primary" disabled={!selected.length} onClick={() => setBulkOpen(true)}><Icon name="check" />{selected.length ? `Gestionar ${selected.length} seleccionados` : 'Gestionar selección'}</button></div><div className="accounts-bar history-toolbar"><div><b>{history.length}</b> trabajos registrados</div><label><Icon name="search" size={16} /><input placeholder="Buscar cliente, servicio o técnico..." value={search} onChange={event => setSearch(event.target.value)} /></label></div><div className="data-card history-table history-bulk"><div className="table-head"><span><input aria-label="Seleccionar todos" type="checkbox" checked={records.length > 0 && selected.length === records.length} onChange={toggleAll} /></span><span>Fecha</span><span>Cliente</span><span>Servicio</span><span>Técnicos asignados</span><span>Estado</span><span>Acciones</span></div>{records.length ? records.map(record => <div className="history-row" key={record.id}><span><input aria-label={`Seleccionar ${record.client}`} type="checkbox" checked={selected.includes(record.id)} onChange={() => toggle(record.id)} /></span><b>{prettyDate(record.date)}</b><div className="history-client"><strong>{record.client}</strong><small>{record.address || 'Sin dirección'}</small></div><div><em className="role-chip">{record.service}</em></div><div className="history-technicians" title={record.technicians?.join(' / ') || 'Sin asignar'}><span>{technicianNames(record)}</span></div><div><span className={`work-status ${status(record).toLowerCase().replace(/\s/g, '-')}`}>{status(record)}</span>{record.scheduledDate && <small className="scheduled-date">Para: {prettyDate(record.scheduledDate)}</small>}</div><div><button className="secondary detail-button" onClick={() => setDetail(record)}><Icon name="eye" size={16} />Gestionar</button></div></div>) : <div className="empty-state">No hay trabajos para mostrar.</div>}</div>{bulkOpen && <div className="modal-layer"><div className="modal bulk-modal"><button className="close-modal" onClick={() => setBulkOpen(false)}><Icon name="close" /></button><p className="eyebrow">GESTIÓN MÚLTIPLE</p><h2>{selected.length} servicio(s) seleccionados</h2><p>La modificación se aplicará a todos los servicios elegidos.</p><label>Nuevo estado<select value={bulkStatus} onChange={event => setBulkStatus(event.target.value)}><option>Completado</option><option>Cancelado</option><option>Reprogramado</option></select></label>{bulkStatus === 'Reprogramado' && <label>Reprogramar para<input type="date" min={minimumRescheduleDate} value={rescheduleDate} onChange={event => setRescheduleDate(event.target.value)} /></label>}<div className="modal-actions"><button className="secondary" onClick={() => setBulkOpen(false)}>Cancelar</button><button className="primary" disabled={bulkStatus === 'Reprogramado' && (!rescheduleDate || rescheduleDate < minimumRescheduleDate)} onClick={applyBulk}>Aplicar cambios</button></div></div></div>}{detail && <HistoryManagementDetail record={detail} setHistory={setHistory} close={() => setDetail(null)} customers={customers} services={services} employees={employees} />}</>
}

function HistoryManagement({ history, setHistory, customers, services, employees }) {
  return <HistoryBulkView {...{ history, setHistory, customers, services, employees }} />
  const [search, setSearch] = useState('')
  const [detail, setDetail] = useState(null)
  const records = history.filter(record => normalizeSearchText(`${record.client} ${record.service} ${record.technicians?.join(' ')}`).includes(normalizeSearchText(search))).sort((a, b) => b.date.localeCompare(a.date))
  const status = record => record.status || 'Pendiente'
  return <><div className="module-intro"><div><p className="eyebrow">TRABAJOS REALIZADOS</p><h1>Historial técnico</h1><p>Gestioná la confirmación, cancelación o reprogramación de cada servicio.</p></div></div><div className="accounts-bar history-toolbar"><div><b>{history.length}</b> trabajos registrados</div><label><Icon name="search" size={16} /><input placeholder="Buscar cliente, servicio o técnico..." value={search} onChange={event => setSearch(event.target.value)} /></label></div><div className="data-card history-table"><div className="table-head"><span>Fecha</span><span>Cliente</span><span>Servicio</span><span>Estado</span><span>Detalle</span></div>{records.length ? records.map(record => <div className="history-row" key={record.id}><b>{prettyDate(record.date)}</b><div className="history-client"><strong>{record.client}</strong><small>{record.address || 'Sin dirección'}</small></div><div><em className="role-chip">{record.service}</em></div><div><span className={`work-status ${status(record).toLowerCase().replace(/\s/g, '-')}`}>{status(record)}</span>{record.scheduledDate && <small className="scheduled-date">Para: {prettyDate(record.scheduledDate)}</small>}</div><div><button className="secondary detail-button" onClick={() => setDetail(record)}><Icon name="eye" size={16} />Gestionar</button></div></div>) : <div className="empty-state">No hay trabajos para mostrar.</div>}</div>{detail && <HistoryManagementDetail record={detail} setHistory={setHistory} close={() => setDetail(null)} />}</>
}

function HistoryManagementDetail({ record, setHistory, close, customers, services, employees }) {
  const [rescheduleDate, setRescheduleDate] = useState(record.scheduledDate || '')
  const minimumRescheduleDate = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' })
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [pendingAction, setPendingAction] = useState(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState({ customerId: record.customerId || '', serviceId: record.serviceId || '', technicianIds: record.technicianIds || [], teamId: record.teamId || '', team: record.team || '', address: record.address || '', phone: record.phone || '', detail: record.detail || '' })
  const update = patch => {
    // Al elegir una nueva fecha, el servicio deja de pertenecer al día original y vuelve
    // a Pendiente para quedar disponible en la agenda de la fecha reprogramada.
    const isReschedule = patch.status === 'Reprogramado' && patch.scheduledDate
    const changes = isReschedule
      ? { ...patch, date: patch.scheduledDate, status: 'Pendiente', scheduledDate: '', rescheduledFrom: record.date, reprogrammedAt: new Date().toISOString() }
      : patch
    if (isReschedule) window.dispatchEvent(new CustomEvent('pignus:reschedule-service', { detail: { record, nextDate: patch.scheduledDate } }))
    setHistory(previous => previous.map(item => item.id === record.id ? { ...item, ...changes } : item)); close()
  }
  const remove = () => { setHistory(previous => previous.filter(item => item.id !== record.id)); close() }
  const saveChanges = () => {
    const customer = customers.find(item => String(item.customerId) === String(draft.customerId))
    const service = services.find(item => String(item.id) === String(draft.serviceId))
    const technicians = employees.filter(employee => draft.technicianIds.some(id => String(id) === String(employee.id)))
    if (!customer || !service) return
    const patch = { ...draft, customerId: customer.customerId, clientAccount: customer.account, clientNameAtService: customer.name, client: `${customer.account} ${customer.name}`, serviceId: service.id, service: service.name, technicianIds: technicians.map(employee => employee.id), technicians: technicians.map(employee => employee.name) }
    window.dispatchEvent(new CustomEvent('pignus:sync-agenda-service', { detail: { record, patch } })); update(patch)
  }
  const status = record.status || 'Pendiente'
  const setField = field => event => setDraft(previous => ({ ...previous, [field]: event.target.value }))
  useEffect(() => {
    if (!record.technicalObservation && !record.technicalReportedAt) return
    const grid = document.querySelector('.history-detail .history-detail-grid')
    if (!grid || grid.querySelector('.technician-report-detail')) return
    const report = document.createElement('div')
    report.className = 'detail-notes technician-report-detail'
    const title = document.createElement('b'); title.textContent = `Informe del técnico · ${record.technicalStatus || 'Estado informado'}`
    const message = document.createElement('span'); message.textContent = record.technicalObservation || 'Servicio marcado como completado por el técnico.'
    report.append(title, message)
    if (record.technicalReportedAt) {
      const time = document.createElement('small')
      time.textContent = `Informado el ${prettyReportDateTime(record.technicalReportedAt)}`
      report.append(time)
    }
    grid.append(report)
    return () => report.remove()
  }, [record, editing])
  useEffect(() => {
    if (!pendingAction) return undefined
    const layer = document.createElement('div')
    layer.className = 'modal-layer history-action-confirmation'
    const modal = document.createElement('div'); modal.className = 'modal confirm-modal'
    const icon = document.createElement('span'); icon.className = `confirm-icon ${pendingAction.destructive ? 'danger' : ''}`; icon.textContent = pendingAction.icon
    const title = document.createElement('h2'); title.textContent = pendingAction.title
    const detail = document.createElement('p'); detail.textContent = pendingAction.detail
    const actions = document.createElement('div'); actions.className = 'confirm-actions'
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'secondary'; cancel.textContent = 'Volver'
    const confirm = document.createElement('button'); confirm.type = 'button'; confirm.className = pendingAction.destructive ? 'danger-button' : 'primary'; confirm.textContent = pendingAction.confirmLabel
    cancel.onclick = () => setPendingAction(null)
    confirm.onclick = () => { const patch = pendingAction.patch; setPendingAction(null); update(patch) }
    actions.append(cancel, confirm); modal.append(icon, title, detail, actions); layer.append(modal)
    layer.onclick = event => { if (event.target === layer) setPendingAction(null) }
    document.body.append(layer)
    return () => layer.remove()
  }, [pendingAction])
  useEffect(() => {
    // Intercepta las acciones de estado antes de los manejadores legados para confirmar la decisión.
    const actions = document.querySelector('.history-detail .history-actions')
    if (!actions || editing) return undefined
    const intercept = event => {
      const button = event.target.closest('button')
      if (!button || button.classList.contains('delete-history')) return
      const text = button.textContent.trim().toLowerCase()
      let action = null
      if (text.includes('marcar completado')) action = { title: 'Marcar servicio como completado', detail: '¿Confirmás que el servicio fue realizado?', confirmLabel: 'Sí, marcar completado', icon: '✓', patch: { status: 'Completado', scheduledDate: '' } }
      if (text.includes('cancelar servicio')) action = { title: 'Cancelar servicio', detail: '¿Confirmás la cancelación de este servicio?', confirmLabel: 'Sí, cancelar servicio', icon: '!', destructive: true, patch: { status: 'Cancelado', scheduledDate: '' } }
      if (text.includes('reprogramar') && rescheduleDate >= minimumRescheduleDate) action = { title: 'Reprogramar servicio', detail: `¿Confirmás reprogramar el servicio para ${prettyDate(rescheduleDate)}?`, confirmLabel: 'Sí, reprogramar', icon: '↻', patch: { status: 'Reprogramado', scheduledDate: rescheduleDate } }
      if (!action) return
      event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation()
      setPendingAction(action)
    }
    actions.addEventListener('click', intercept, true)
    return () => actions.removeEventListener('click', intercept, true)
  }, [editing, rescheduleDate, minimumRescheduleDate])
  useEffect(() => {
    if (editing) return undefined
    const grid = document.querySelector('.history-detail .history-detail-grid')
    if (!grid || grid.querySelector('.scheduled-time-detail')) return undefined
    const scheduledTime = document.createElement('div')
    scheduledTime.className = 'scheduled-time-detail'
    const title = document.createElement('b'); title.textContent = 'Hora asignada'
    // Los registros históricos sin horario mantienen el campo vacío.
    const value = document.createElement('span'); value.textContent = record.time || record.scheduledTime || ''
    scheduledTime.append(title, value)
    grid.insertBefore(scheduledTime, grid.children[2] || null)
    return () => scheduledTime.remove()
  }, [record, editing])
  return <><div className="modal-layer"><div className="modal detail-modal history-detail"><button className="close-modal" onClick={close}><Icon name="close" /></button><p className="eyebrow">{prettyDate(record.date)} · {status.toUpperCase()}</p><div className="history-detail-heading"><h2>{editing ? 'Editar servicio' : record.client}</h2><button className="secondary detail-edit" onClick={() => setEditing(!editing)}><Icon name="edit" size={15} />{editing ? 'Cancelar edición' : 'Editar datos'}</button></div>{editing ? <div className="history-edit-grid"><label>Cliente o cuenta<select value={draft.customerId} onChange={setField('customerId')}><option value="">Seleccionar</option>{customers.map(customer => <option key={customer.customerId} value={customer.customerId}>{customer.account} · {customer.name}</option>)}</select></label><label>Tipo de servicio<select value={draft.serviceId} onChange={setField('serviceId')}><option value="">Seleccionar</option>{services.map(service => <option key={service.id} value={service.id}>{service.name}</option>)}</select></label><label>Equipo<input readOnly value={draft.team} title="La identidad del equipo se conserva mediante su ID interno" /></label><label>Técnicos asignados<select multiple value={draft.technicianIds} onChange={event => setDraft(previous => ({ ...previous, technicianIds: [...event.target.selectedOptions].map(option => option.value) }))}>{employees.map(employee => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</select></label><label>Dirección<input value={draft.address} onChange={setField('address')} /></label><label>Contacto<input value={draft.phone} onChange={setField('phone')} /></label><label className="detail-notes">Detalle / observaciones<textarea value={draft.detail} onChange={setField('detail')} /></label></div> : <div className="history-detail-grid"><div><b>Servicio</b><span>{record.service}</span></div><div><b>Equipo</b><span>{record.team}</span></div><div><b>Técnicos asignados</b><span>{record.technicians?.join(' / ') || 'Sin técnicos asignados'}</span></div><div><b>Dirección</b><span>{record.address || 'Sin dirección'}</span></div><div><b>Contacto</b><span>{record.phone || 'Sin contacto'}</span></div><div className="detail-notes"><b>Detalle / observaciones</b><span>{record.detail || 'Sin observaciones'}</span></div></div>}{editing ? <div className="history-actions"><button className="primary" onClick={saveChanges}><Icon name="check" />Guardar cambios</button><button className="secondary" onClick={() => setEditing(false)}>Cancelar</button></div> : <div className="history-actions"><button className="primary" onClick={() => update({ status: 'Completado', scheduledDate: '' })}><Icon name="check" />Marcar completado</button><button className="secondary" onClick={() => update({ status: 'Cancelado', scheduledDate: '' })}><Icon name="close" />Cancelar servicio</button><label>Reprogramar para<input type="date" min={minimumRescheduleDate} value={rescheduleDate} onChange={event => setRescheduleDate(event.target.value)} /></label><button className="secondary" disabled={!rescheduleDate || rescheduleDate < minimumRescheduleDate} onClick={() => { if (rescheduleDate >= minimumRescheduleDate) update({ status: 'Reprogramado', scheduledDate: rescheduleDate }) }}><Icon name="calendar" />Reprogramar</button><button className="danger-button delete-history" onClick={() => setConfirmDelete(true)}><Icon name="trash" />Eliminar registro</button></div>}</div></div>{confirmDelete && <Confirm title="Eliminar registro" detail="¿Querés eliminar este servicio del historial? Esta acción no se puede deshacer." destructive action={remove} close={() => setConfirmDelete(false)} />}</> }

function HistoryDetail({ record, close }) { return <div className="modal-layer"><div className="modal detail-modal history-detail"><button className="close-modal" onClick={close}><Icon name="close" /></button><p className="eyebrow">{prettyDate(record.date)}</p><h2>{record.client}</h2><div className="history-detail-grid"><div><b>Servicio</b><span>{record.service}</span></div><div><b>Equipo</b><span>{record.team}</span></div><div><b>Técnicos asignados</b><span>{record.technicians?.join(' / ') || 'Sin técnicos asignados'}</span></div><div><b>Dirección</b><span>{record.address || 'Sin dirección'}</span></div><div><b>Contacto</b><span>{record.phone || 'Sin contacto'}</span></div><div className="detail-notes"><b>Detalle / observaciones</b><span>{record.detail || 'Sin observaciones'}</span></div></div></div></div> }

function Reviews({ reviews, setReviews, customers, setNotice, ask }) {
  const empty = () => ({ id: '', customerId: '', customerCode: '', author: '', date: new Date().toISOString().slice(0, 10), rating: 5, channel: 'Google', status: 'Pendiente', comment: '' })
  const [form, setForm] = useState(empty)
  const [editing, setEditing] = useState(null)
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('Todos')
  const visible = useMemo(() => reviews
    .filter(review => statusFilter === 'Todos' || review.status === statusFilter)
    .filter(review => normalizeSearchText(`${review.author} ${review.customerCode} ${review.comment} ${review.channel}`).includes(normalizeSearchText(search)))
    .sort((a, b) => String(b.date).localeCompare(String(a.date))), [reviews, search, statusFilter])
  const chooseCustomer = event => {
    const customer = customers.find(item => String(item.customerId) === event.target.value)
    setForm(previous => customer ? { ...previous, customerId: customer.customerId, customerCode: customer.account, author: customer.name } : { ...previous, customerId: '', customerCode: '' })
  }
  const save = event => {
    event.preventDefault()
    const record = { ...form, id: editing || form.id || globalThis.crypto?.randomUUID?.() || `review-${Date.now()}`, rating: Number(form.rating) }
    ask(editing ? 'Guardar reseña' : 'Registrar reseña', `¿Querés guardar la reseña de ${record.author}?`, () => {
      setReviews(previous => editing ? previous.map(item => item.id === editing ? record : item) : [record, ...previous])
      setOpen(false); setEditing(null); setForm(empty()); setNotice('La reseña fue guardada correctamente.')
    })
  }
  const edit = review => { setForm(review); setEditing(review.id); setOpen(true) }
  return <><div className="module-intro"><div><p className="eyebrow">EXPERIENCIA DEL CLIENTE</p><h1>Reseñas</h1><p>Registrá y administrá las opiniones recibidas de abonados y clientes.</p></div><button className="primary" onClick={() => { setForm(empty()); setEditing(null); setOpen(true) }}><Icon name="plus" />Nueva reseña</button></div>{open && <form className="review-form data-card" onSubmit={save}><label>Abonado o cliente<select value={form.customerId || ''} onChange={chooseCustomer}><option value="">Sin vincular / ingreso manual</option>{customers.map(customer => <option key={customer.customerId} value={customer.customerId}>{customer.account} · {customer.name}</option>)}</select></label><label>Nombre<input required value={form.author} onChange={event => setForm({ ...form, author: event.target.value })} /></label><label>Fecha<input required type="date" value={form.date} onChange={event => setForm({ ...form, date: event.target.value })} /></label><label>Calificación<select value={form.rating} onChange={event => setForm({ ...form, rating: Number(event.target.value) })}>{[5, 4, 3, 2, 1].map(value => <option key={value} value={value}>{value} estrella{value === 1 ? '' : 's'}</option>)}</select></label><label>Canal<select value={form.channel} onChange={event => setForm({ ...form, channel: event.target.value })}><option>Google</option><option>WhatsApp</option><option>Facebook</option><option>Instagram</option><option>Encuesta</option><option>Otro</option></select></label><label>Estado<select value={form.status} onChange={event => setForm({ ...form, status: event.target.value })}><option>Pendiente</option><option>Publicada</option><option>Archivada</option></select></label><label className="review-comment">Comentario<textarea required value={form.comment} onChange={event => setForm({ ...form, comment: event.target.value })} placeholder="Escribí la opinión recibida..." /></label><div className="review-form-actions"><button className="primary"><Icon name="check" />Guardar reseña</button><button type="button" className="secondary" onClick={() => setOpen(false)}>Cancelar</button></div></form>}<div className="reviews-summary"><div><b>{reviews.length}</b><span> reseñas registradas</span></div><label><Icon name="search" size={16} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar por cliente o comentario..." /></label><select aria-label="Filtrar por estado" value={statusFilter} onChange={event => setStatusFilter(event.target.value)}><option>Todos</option><option>Pendiente</option><option>Publicada</option><option>Archivada</option></select></div><div className="data-card reviews-table"><div className="table-head"><span>Fecha</span><span>Abonado / Cliente</span><span>Calificación</span><span>Comentario</span><span>Canal</span><span>Estado</span><span>Acciones</span></div>{visible.length ? visible.map(review => <div className="review-row" key={review.id}><span>{prettyDate(review.date)}</span><div><b>{review.author}</b><small>{review.customerCode || 'Sin vincular'}</small></div><span className="review-stars" aria-label={`${review.rating} de 5 estrellas`}>{'★'.repeat(review.rating)}{'☆'.repeat(5 - review.rating)}</span><p title={review.comment}>{review.comment}</p><span>{review.channel}</span><em className={`work-status ${review.status.toLowerCase()}`}>{review.status}</em><div className="row-actions"><button title="Editar reseña" onClick={() => edit(review)}><Icon name="edit" size={16} /></button><button className="delete" title="Eliminar reseña" onClick={() => ask('Eliminar reseña', `¿Querés eliminar la reseña de ${review.author}?`, () => { setReviews(previous => previous.filter(item => item.id !== review.id)); setNotice('La reseña fue eliminada.') }, true)}><Icon name="trash" size={16} /></button></div></div>) : <div className="empty-state">No hay reseñas para mostrar.</div>}</div></>
}

function Accounts({ customers, setCustomers, setNotice, ask, history, teams, weekly, reviews }) {
  const [search, setSearch] = useState(''); const [form, setForm] = useState(blankCustomer); const [editing, setEditing] = useState(null); const [showForm, setShowForm] = useState(false); const [importOpen, setImportOpen] = useState(false); const [detail, setDetail] = useState(null)
  const [pageSize, setPageSize] = useState(20); const [page, setPage] = useState(1)
  const visible = useMemo(() => customers
    .filter(c => normalizeSearchText(`${c.account} ${c.name} ${c.locality}`).includes(normalizeSearchText(search)))
    .sort((a, b) => String(a.account || '').localeCompare(String(b.account || ''), 'es', { numeric: true, sensitivity: 'base' })), [customers, search])
  const totalPages = Math.max(1, Math.ceil(visible.length / pageSize))
  const currentPage = Math.min(page, totalPages)
  const paginatedCustomers = visible.slice((currentPage - 1) * pageSize, currentPage * pageSize)
  useEffect(() => setPage(1), [search, pageSize])
  const save = e => {
    e.preventDefault()
    const kind = customerKind(form)
    const customer = { ...form, customerId: form.customerId || createCustomerId(), kind, account: normalizeAccountKey(form.account || nextCustomerCode(customers, kind)), address: [form.street, form.locality, form.province].filter(Boolean).join(', ') }
    ask(editing ? 'Confirmar edición' : 'Confirmar alta', `¿Querés guardar los cambios de ${customer.name}?`, () => {
      setCustomers(previous => editing ? previous.map(item => item.customerId === editing ? customer : item) : [...previous, customer])
      setShowForm(false); setEditing(null); setNotice(`${customerKindLabel(customer)} guardado correctamente.`)
    })
  }
  const edit = customer => { setForm(customer); setEditing(customer.customerId); setShowForm(true) }
  const startNew = () => { const kind = 'client'; setEditing(null); setForm({ ...blankCustomer, customerId: createCustomerId(), kind, account: nextCustomerCode(customers, kind) }); setShowForm(true) }
  const removeCustomer = customer => {
    const agendaTeams = [...(teams || []), ...Object.entries(weekly || {}).flatMap(([key, value]) => key === '_monthlyTeams' ? Object.values(value || {}).flatMap(config => config?.teams || []) : key.startsWith('_') ? [] : value?.teams || [])]
    const referenced = history.some(record => String(record.customerId) === String(customer.customerId)) || reviews.some(review => String(review.customerId) === String(customer.customerId)) || agendaTeams.some(team => (team.tasks || []).some(task => String(task.customerId) === String(customer.customerId)))
    if (referenced) { setNotice('No se puede eliminar: el abonado o cliente tiene servicios o reseñas vinculadas.'); return }
    setCustomers(items => items.filter(item => item.customerId !== customer.customerId)); setNotice('El registro fue eliminado.')
  }
  return <><div className="module-intro"><div><p className="eyebrow">REGISTRO COMERCIAL</p><h1>Abonados y clientes</h1><p>Los códigos PIG identifican abonados; los códigos CLI, clientes sin abono.</p></div><div className="action-group"><button className="secondary" onClick={() => setImportOpen(true)}><Icon name="upload" />Importar abonados</button><button className="primary" onClick={startNew}><Icon name="plus" />Nuevo cliente</button></div></div>{showForm && <CustomerForm form={form} setForm={setForm} editing={editing} customers={customers} save={save} cancel={() => setShowForm(false)} />}<div className="accounts-bar"><div><b>{customers.length}</b> registros</div><label><Icon name="search" size={16} /><input placeholder="Buscar por nombre, código o localidad..." value={search} onChange={e => setSearch(e.target.value)} /></label></div><div className="data-card accounts-table"><div className="table-head">{['Código', 'Abonado / Cliente', 'Dirección', 'Teléfono', 'Acciones'].map(x => <span key={x}>{x}</span>)}</div>{visible.length ? paginatedCustomers.map(customer => <div className="account-row" key={customer.customerId}><b>{customer.account}</b><div><strong>{customer.name}</strong><small>{customerKindLabel(customer)} · {customer.type || 'Sin categoría'}</small></div><div>{customer.address}</div><div>{customer.phone || 'Sin teléfono'}</div><div className="row-actions"><button title="Ver información completa" onClick={() => setDetail(customer)}><Icon name="eye" size={16} /></button><button title="Editar" onClick={() => edit(customer)}><Icon name="edit" size={16} /></button><button className="delete" title="Eliminar" onClick={() => ask(`Eliminar ${customerKindLabel(customer).toLowerCase()}`, `¿Querés eliminar ${customer.account}? Esta acción no se puede deshacer.`, () => removeCustomer(customer), true)}><Icon name="trash" size={16} /></button></div></div>) : <div className="empty-state">No hay abonados o clientes para mostrar.</div>}</div>{visible.length > 0 && <nav className="accounts-pagination" aria-label="Paginación de abonados y clientes"><div className="pagination-size"><span>Mostrar</span><select value={pageSize} onChange={event => setPageSize(Number(event.target.value))}><option value={20}>20</option><option value={50}>50</option><option value={100}>100</option></select><span>registros</span></div><span className="pagination-summary">{(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, visible.length)} de {visible.length}</span><div className="pagination-controls"><button className="secondary" disabled={currentPage === 1} onClick={() => setPage(previous => Math.max(1, previous - 1))}>Anterior</button><span>Página {currentPage} de {totalPages}</span><button className="secondary" disabled={currentPage === totalPages} onClick={() => setPage(previous => Math.min(totalPages, previous + 1))}>Siguiente</button></div></nav>}{importOpen && <ImportModal {...{ customers, setCustomers, close: () => setImportOpen(false), setNotice }} />}{detail && <CustomerDetail customer={detail} close={() => setDetail(null)} />}</>
}
function CustomerForm({ form, setForm, editing, customers, save, cancel }) { const set = key => e => setForm({ ...form, [key]: e.target.value }); const changeKind = event => { const kind = event.target.value; setForm({ ...form, kind, account: editing ? form.account : nextCustomerCode(customers, kind) }) }; return <form className="customer-form" onSubmit={save}><label>Condición<select disabled={!!editing} value={customerKind(form)} onChange={changeKind}><option value="subscriber">Abonado</option><option value="client">Cliente</option></select></label><label>Código<input required readOnly value={form.account} /></label><label>Nombre<input required value={form.name} onChange={set('name')} /></label><label>Categoría<input value={form.type} onChange={set('type')} placeholder="Ej.: Residencial o Comercial" /></label><label>Calle<input value={form.street} onChange={set('street')} /></label><label>Localidad<input value={form.locality} onChange={set('locality')} /></label><label>Provincia / Estado<input value={form.province} onChange={set('province')} /></label><label>Teléfono<input value={form.phone} onChange={set('phone')} /></label><button className="primary"><Icon name="check" />Guardar {customerKindLabel(form).toLowerCase()}</button><button type="button" className="secondary" onClick={cancel}>Cancelar</button></form> }

function ServiceTypes({ services, setServices, setNotice, ask, history, teams, weekly }) {
  const [form, setForm] = useState({ name: '', description: '', status: 'Activo' })
  const [editing, setEditing] = useState(null)
  const [open, setOpen] = useState(false)
  const save = event => {
    event.preventDefault()
    const nextId = editing || Date.now()
    const record = { ...form, id: nextId, code: editing ? serviceCode(form) : `service-${nextId}`, category: editing ? (form.category || 'service') : (normalizeServiceName(form.name).startsWith('instalacion') ? 'installation' : 'service') }
    ask(editing ? 'Confirmar edición' : 'Confirmar alta', `¿Querés guardar el tipo de servicio ${record.name}?`, () => {
      setServices(previous => editing ? previous.map(service => service.id === editing ? record : service) : [...previous, record])
      setOpen(false); setEditing(null); setNotice('El tipo de servicio fue guardado correctamente.')
    })
  }
  const removeService = service => {
    const agendaTeams = [...(teams || []), ...Object.entries(weekly || {}).flatMap(([key, value]) => key === '_monthlyTeams' ? Object.values(value || {}).flatMap(config => config?.teams || []) : key.startsWith('_') ? [] : value?.teams || [])]
    const referenced = history.some(record => String(record.serviceId) === String(service.id)) || agendaTeams.some(team => (team.tasks || []).some(task => String(task.serviceId) === String(service.id)))
    if (referenced) { setServices(previous => previous.map(item => item.id === service.id ? { ...item, status: 'Inactivo' } : item)); setNotice('El servicio tiene registros vinculados: se marcó como inactivo en lugar de eliminarlo.'); return }
    setServices(previous => previous.filter(item => item.id !== service.id)); setNotice('El tipo de servicio fue eliminado.')
  }
  return <><div className="module-intro"><div><p className="eyebrow">CATÁLOGO OPERATIVO</p><h1>Tipo de servicio</h1><p>Administrá los servicios disponibles para planificar en la agenda técnica.</p></div><button className="primary" onClick={() => { setForm({ name: '', description: '', status: 'Activo' }); setEditing(null); setOpen(true) }}><Icon name="plus" />Nuevo servicio</button></div>{open && <form className="service-form" onSubmit={save}><label>Nombre del servicio<input required value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></label><label>Descripción<input value={form.description} onChange={event => setForm({ ...form, description: event.target.value })} /></label><button className="primary"><Icon name="check" />{editing ? 'Guardar cambios' : 'Guardar servicio'}</button><button type="button" className="secondary" onClick={() => setOpen(false)}>Cancelar</button></form>}<div className="data-card services-table"><div className="table-head"><span>Servicio</span><span>Descripción</span><span>Estado</span><span>Acciones</span></div>{services.map(service => <div className="service-row" key={service.id}><b>{service.name}</b><span>{service.description || 'Sin descripción'}</span><div><button className={`status ${service.status === 'Activo' ? 'on' : ''}`} onClick={() => ask('Cambiar estado', `¿Querés marcar ${service.name} como ${service.status === 'Activo' ? 'inactivo' : 'activo'}?`, () => setServices(previous => previous.map(item => item.id === service.id ? { ...item, status: item.status === 'Activo' ? 'Inactivo' : 'Activo' } : item)))}>{service.status}</button></div><div className="row-actions"><button title="Editar servicio" onClick={() => { setForm(service); setEditing(service.id); setOpen(true) }}><Icon name="edit" size={16} /></button><button className="delete" title="Eliminar servicio" onClick={() => ask('Eliminar servicio', `¿Querés eliminar ${service.name}?`, () => removeService(service), true)}><Icon name="trash" size={16} /></button></div></div>)}</div></>
}

function Employees({ employees, setEmployees, roles, setNotice, ask, history, teams, weekly }) {
  const [form, setForm] = useState(blankEmployee); const [editing, setEditing] = useState(null); const [open, setOpen] = useState(false)
  const save = e => { e.preventDefault(); const firstName = form.firstName.trim(); const lastName = form.lastName.trim(); const assignedRole = roles.find(role => String(role.id) === String(form.roleId)) || roles.find(role => role.name === form.role); const record = { ...form, firstName, lastName, name: `${firstName} ${lastName}`.trim(), roleId: assignedRole?.id, role: assignedRole?.name || form.role, id: editing || Date.now() }; ask(editing ? 'Confirmar edición' : 'Confirmar alta', `¿Querés guardar el perfil de ${record.name}?`, () => { setEmployees(prev => editing ? prev.map(x => x.id === editing ? record : x) : [...prev, record]); setOpen(false); setEditing(null); setNotice('El empleado fue guardado correctamente.') }) }
  const removeEmployee = employee => {
    const agendaTeams = [...(teams || []), ...Object.entries(weekly || {}).flatMap(([key, value]) => key === '_monthlyTeams' ? Object.values(value || {}).flatMap(config => config?.teams || []) : key.startsWith('_') ? [] : value?.teams || [])]
    const referenced = history.some(record => (record.technicianIds || []).some(id => String(id) === String(employee.id))) || agendaTeams.some(team => (team.memberIds || []).some(id => String(id) === String(employee.id)))
    if (referenced) { setEmployees(previous => previous.map(item => item.id === employee.id ? { ...item, status: 'Inactivo' } : item)); setNotice('El empleado tiene asignaciones vinculadas: se marcó como inactivo en lugar de eliminarlo.'); return }
    setEmployees(previous => previous.filter(item => item.id !== employee.id)); setNotice('El empleado fue eliminado.')
  }
  return <><div className="module-intro"><div><p className="eyebrow">EQUIPO PIGNUS</p><h1>Técnicos y colaboradores</h1><p>Administrá accesos, datos de contacto y disponibilidad del equipo.</p></div><button className="primary" onClick={() => { setForm(blankEmployee); setEditing(null); setOpen(true) }}><Icon name="plus" />Nuevo empleado</button></div>{open && <EmployeeForm {...{ form, setForm, roles, save, cancel: () => setOpen(false), editing }} />}<div className="data-card employees-table"><div className="table-head">{['Empleado', 'Rol', 'Correo', 'Contacto', 'Estado', 'Acciones'].map(x => <span key={x}>{x}</span>)}</div>{employees.map(x => <div className="employee-row" key={x.id}><div className="person"><span>{initials(x.name)}</span><b>{x.name}</b></div><div><em className="role-chip">{roles.find(role => String(role.id) === String(x.roleId))?.name || x.role}</em></div><div>{x.email}</div><div>{x.phone || 'Sin teléfono'}</div><div><button className={`status ${x.status === 'Activo' ? 'on' : ''}`} onClick={() => ask('Cambiar estado', `¿Querés marcar a ${x.name} como ${x.status === 'Activo' ? 'inactivo' : 'activo'}?`, () => setEmployees(prev => prev.map(y => y.id === x.id ? { ...y, status: y.status === 'Activo' ? 'Inactivo' : 'Activo' } : y)))}>{x.status}</button></div><div className="row-actions"><button title="Editar empleado" onClick={() => { setForm(x); setEditing(x.id); setOpen(true) }}><Icon name="edit" size={16} /></button><button className="delete" title="Eliminar empleado" onClick={() => ask('Eliminar empleado', `¿Querés eliminar el perfil de ${x.name}?`, () => removeEmployee(x), true)}><Icon name="trash" size={16} /></button></div></div>)}</div></>
}
function EmployeeForm({ form, setForm, roles, save, cancel, editing }) { const set = key => e => setForm({ ...form, [key]: e.target.value }); return <form className="employee-form employee-form-wide" onSubmit={save}><label>Nombre<input required value={form.firstName || ''} onChange={set('firstName')} /></label><label>Apellido<input required value={form.lastName || ''} onChange={set('lastName')} /></label><label>Rol<select value={form.roleId ?? roles.find(role => role.name === form.role)?.id ?? ''} onChange={event => { const selectedRole = roles.find(role => String(role.id) === event.target.value); setForm({ ...form, roleId: selectedRole?.id, role: selectedRole?.name || '' }) }}>{roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label><label>Teléfono<input value={form.phone} onChange={set('phone')} /></label><label>Correo electrónico<input required type="email" value={form.email} onChange={set('email')} /></label><label>Contraseña<input required={!editing} minLength="8" autoComplete="new-password" type="password" value={form.password || ''} placeholder={editing ? 'Dejar vacío para conservarla' : 'Mínimo 8 caracteres'} onChange={set('password')} /></label><button className="primary"><Icon name="check" />{editing ? 'Guardar cambios' : 'Guardar empleado'}</button><button type="button" className="secondary" onClick={cancel}>Cancelar</button></form> }

function Settings({ roles, setRoles, setNotice, ask }) {
  const [active, setActive] = useState(roles[0]?.id); const [editing, setEditing] = useState(false); const [name, setName] = useState(''); const [description, setDescription] = useState(''); const role = roles.find(x => x.id === active) || roles[0]
  const startEdit = r => { setActive(r.id); setName(r.name); setDescription(r.description); setEditing(true) }
  const save = () => { const nextId = editing === 'new' ? Date.now() : role.id; const next = { id: nextId, code: editing === 'new' ? `role-${nextId}` : roleCode(role), name, description, permissions: editing === 'new' ? { ...DEFAULT_MODULE_PERMISSIONS, dashboard: true, agenda: true } : { ...DEFAULT_MODULE_PERMISSIONS, ...role.permissions } }; ask(editing === 'new' ? 'Crear rol' : 'Guardar permisos', `¿Querés confirmar los cambios del rol ${name}?`, () => { setRoles(prev => editing === 'new' ? [...prev, next] : prev.map(x => x.id === role.id ? next : x)); setActive(next.id); setEditing(false); setNotice('La configuración del rol fue guardada.') }) }
  const toggle = key => ask('Modificar permiso', `¿Querés ${role.permissions?.[key] ? 'revocar' : 'otorgar'} este permiso al rol ${role.name}?`, () => setRoles(prev => prev.map(x => x.id === role.id ? { ...x, permissions: { ...DEFAULT_MODULE_PERMISSIONS, ...x.permissions, [key]: !x.permissions?.[key] } } : x)))
  return <><div className="module-intro"><div><p className="eyebrow">ADMINISTRACIÓN</p><h1>Roles y permisos</h1><p>Definí el acceso que tendrá cada integrante de la plataforma.</p></div><button className="primary" onClick={() => { setName(''); setDescription(''); setEditing('new') }}><Icon name="plus" />Nuevo rol</button></div><div className="settings-grid"><article className="data-card roles-card"><h2>Roles disponibles</h2>{roles.map(r => <div className={r.id === role?.id ? 'selected-role' : ''} key={r.id} onClick={() => setActive(r.id)}><span className="role-dot">{r.name[0]}</span><div><b>{r.name}</b><p>{r.description}</p></div><button onClick={e => { e.stopPropagation(); startEdit(r) }} title="Editar rol"><Icon name="edit" size={16} /></button></div>)}</article><article className="data-card permissions-card">{editing ? <div className="role-editor"><p className="eyebrow">{editing === 'new' ? 'NUEVO ROL' : 'EDITAR ROL'}</p><label>Nombre del rol<input value={name} onChange={e => setName(e.target.value)} /></label><label>Descripción<input value={description} onChange={e => setDescription(e.target.value)} /></label><button className="primary" onClick={save}><Icon name="check" />Guardar rol</button><button className="secondary" onClick={() => setEditing(false)}>Cancelar</button></div> : <><p className="eyebrow">PERFIL: {role?.name?.toUpperCase()}</p><h2>Permisos del módulo</h2>{MODULE_PERMISSIONS.map(([key, label, detail]) => { const auditOnly = key === 'audit'; const adminRole = roleCode(role) === 'administrator'; return <label className={`permission ${auditOnly ? 'locked-permission' : ''}`} key={key}><span><b>{label}</b><small>{auditOnly ? 'Exclusivo del rol Administrador' : detail}</small></span><input type="checkbox" checked={auditOnly ? adminRole : !!role?.permissions?.[key]} disabled={auditOnly} onChange={() => toggle(key)} /><i /></label> })}<button className="primary save" onClick={() => startEdit(role)}><Icon name="edit" />Editar rol</button></>}</article></div></>
}

function ImportModal({ customers, setCustomers, close, setNotice }) {
  const [message, setMessage] = useState('')

  const importFile = async e => {
    const file = e.target.files?.[0]
    if (!file) return

    const doc = new DOMParser().parseFromString(await file.text(), 'text/html')
    const table = [...doc.querySelectorAll('table')].find(t => t.textContent.toLowerCase().includes('dealer/cuenta'))
    if (!table) return setMessage('No se encontró una tabla con la columna Dealer/Cuenta.')

    const rows = [...table.querySelectorAll('tr')]
      .map(r => [...r.querySelectorAll('th,td')].map(c => c.textContent.replace(/\s+/g, ' ').trim()))
      .filter(r => r.length)
    const headers = rows.shift()
    const get = (row, label) => row[headers.findIndex(x => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase() === label)] || ''

    const imported = rows.map(row => {
      const account = normalizeAccountKey(get(row, 'dealercuenta'))
      const street = get(row, 'calle'), locality = get(row, 'localidad'), province = get(row, 'provinciaestado')
      return account ? { customerId: '', kind: 'subscriber', account, name: get(row, 'nombre'), type: get(row, 'tipodecuenta'), street, locality, province, phone: get(row, 'telefono'), address: [street, locality, province].filter(Boolean).join(', '), fields: Object.fromEntries(headers.map((h, i) => [h, row[i] || ''])) } : null
    }).filter(Boolean)
    if (!imported.length) return setMessage('El archivo no contiene registros válidos.')

    // The report is incremental: accounts not included in the file stay intact.
    // Matching accounts are updated, while missing report values preserve prior
    // customer data instead of accidentally erasing it.
    const existingByAccount = new Map(customers.map(customer => [normalizeAccountKey(customer.account), customer]))
    const importedKeys = new Set(imported.map(customer => customer.account))
    const updated = imported.filter(customer => existingByAccount.has(customer.account)).length
    const merged = imported.map(customer => {
      const previous = existingByAccount.get(customer.account)
      if (!previous) return { ...customer, customerId: createCustomerId() }
      const next = { ...previous, ...customer }
      ;['name', 'type', 'street', 'locality', 'province', 'phone', 'address'].forEach(field => {
        if (!customer[field]) next[field] = previous[field] || ''
      })
      next.fields = { ...(previous.fields || {}), ...(customer.fields || {}) }
      return next
    })
    setCustomers([...customers.filter(customer => !importedKeys.has(normalizeAccountKey(customer.account))), ...merged])
    setNotice(`Importación finalizada: ${imported.length - updated} abonados nuevos y ${updated} actualizados.`)
    close()
  }

  return <div className="modal-layer"><div className="modal"><button className="close-modal" onClick={close}><Icon name="close" /></button><p className="eyebrow">IMPORTACIÓN MASIVA</p><h2>Importar abonados</h2><p>Seleccioná el reporte exportado. Las coincidencias por <b>Dealer/Cuenta</b> se actualizarán como abonados PIG.</p><label className="file-drop"><Icon name="upload" size={30} /><b>Seleccioná un archivo .xls</b><small>Formato Maestro de Cuentas</small><input type="file" accept=".xls,.html" onChange={importFile} /></label>{message && <p className="import-error">{message}</p>}<div className="modal-info"><b>Campos importados</b><span>Se conserva toda la información disponible en el reporte.</span></div></div></div>
}
function CustomerDetail({ customer, close }) { const entries = Object.entries(customer.fields || {}).filter(([, v]) => v); return <div className="modal-layer"><div className="modal detail-modal"><button className="close-modal" onClick={close}><Icon name="close" /></button><p className="eyebrow">{customerKindLabel(customer).toUpperCase()} · {customer.account}</p><h2>{customer.name}</h2><div className="detail-grid">{entries.length ? entries.map(([k, v]) => <div key={k}><b>{k}</b><span>{v}</span></div>) : <><div><b>Dirección</b><span>{customer.address}</span></div><div><b>Teléfono</b><span>{customer.phone}</span></div></>}</div></div></div> }
function Preview({ title, text, close }) { const format = line => line.split(/(\*[^*]+\*)/g).map((part, index) => part.startsWith('*') && part.endsWith('*') ? <strong key={index}>{part.slice(1, -1)}</strong> : part); return <div className="modal-layer"><div className="modal preview-modal"><button className="close-modal" onClick={close}><Icon name="close" /></button><p className="eyebrow">AGENDA TÉCNICA</p><h2>{title}</h2><div className="whatsapp-preview">{text.split('\n').map((line, index) => line ? <p key={index}>{format(line)}</p> : <div className="preview-space" key={index} />)}</div></div></div> }
function Confirm({ title, detail, action, destructive, confirmLabel, close }) { return <div className="modal-layer"><div className="modal confirm-modal"><span className={destructive ? 'confirm-icon danger' : 'confirm-icon'}>{destructive ? <Icon name="trash" /> : <Icon name="lock" />}</span><h2>{title}</h2><p>{detail}</p><div className="confirm-actions"><button className="secondary" onClick={close}>Cancelar</button><button className={destructive ? 'danger-button' : 'primary'} onClick={() => { action(); close() }}>{confirmLabel || (destructive ? 'Sí, eliminar' : 'Confirmar cambios')}</button></div></div></div> }

// Stable category colors: independent of urgency, wording and destination permissions.
export const notificationCategories = {
  collection: { label: 'Cobranzas', icon: 'wallet', light: '#187047', dark: '#76d6a3' },
  ticket: { label: 'Tickets', icon: 'ticket', light: '#235db5', dark: '#82b6ff' },
  reservation: { label: 'Reservas', icon: 'accounts', light: '#08768b', dark: '#6bd5ed' },
  today: { label: 'Pendientes de hoy', icon: 'calendar', light: '#8a6200', dark: '#f3ce67' },
  confirmation: { label: 'Confirmaciones', icon: 'agenda', light: '#5044a5', dark: '#b4a9ff' },
  rescheduling: { label: 'Reprogramación y coordinación', icon: 'refresh', light: '#a3490c', dark: '#ffb479' },
  overdue: { label: 'Servicios atrasados', icon: 'history', light: '#b12b32', dark: '#ff9298' },
  insurance: { label: 'Seguros vehiculares', icon: 'shield', light: '#8a344f', dark: '#eaa1b8' },
  zones: { label: 'Zonas de alarma', icon: 'settings', light: '#8045ae', dark: '#cea0f3' },
  softguard: { label: 'Verificación en SoftGuard', icon: 'search', light: '#0d7469', dark: '#72d5c7' },
  retirement: { label: 'Bajas en SoftGuard', icon: 'trash', light: '#81533b', dark: '#d9b198' },
  followup: { label: 'Seguimientos', icon: 'check', light: '#963e8d', dark: '#e4a0db' },
  advance: { label: 'Adelantos de servicio', icon: 'clock', light: '#63711c', dark: '#c2d77b' },
  password: { label: 'Acceso y contraseñas', icon: 'lock', light: '#526177', dark: '#b2c1d8' },
  experience: { label: 'Experiencia del cliente', icon: 'mail', light: '#ac3767', dark: '#ff9ec7' },
  general: { label: 'Otros avisos', icon: 'bell', light: '#616161', dark: '#c6c6c6' }
}

export function notificationAppearance(notification = {}) {
  const id = String(notification.id || ''), target = notification.target || {}
  const prefix = id.split(':')[0]
  let category = {
    collection: 'collection', ticket: 'ticket', reservation: 'reservation', insurance: 'insurance',
    'alarm-zones': 'zones', 'softguard-retirement': 'retirement', 'softguard-verification': 'softguard',
    followup: 'followup', advance: 'advance', password: 'password', 'experience-mail': 'experience',
    'pending-work': 'rescheduling'
  }[prefix]
  if (prefix === 'pending') category = id.split(':')[1]
  if (!category) category = {
    collection: 'collection', ticket: 'ticket', reservation: 'reservation', vehicle: 'insurance',
    'alarm-zones': 'zones', 'softguard-retirement': 'retirement', softguard: 'softguard',
    followup: 'followup', 'advance-request': 'advance', 'password-reset': 'password', 'experience-mail': 'experience'
  }[target.type] || target.pendingGroup || (target.section === 'reservation' ? 'reservation' : target.section?.replace(/^pending-/, ''))
  if (!notificationCategories[category]) category = 'general'
  return { category, ...notificationCategories[category] }
}

export const notificationColorStyle = appearance => ({ '--notification-light': appearance.light, '--notification-dark': appearance.dark })

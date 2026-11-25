import guardRotation from '../../../api/_lib/annual-guard-rotation.cjs'
import guardEligibility from '../../../api/_lib/guard-eligibility.cjs'
import guardAssignmentPolicy from '../../../api/_lib/guard-assignment-policy.cjs'
import { monthlyEligibleTechnicians } from './monthly-team-rotation.mjs'
export const DEFAULT_2026_GUARD_ROTATION = [
  ['rodrigo', 'gonzalez'],
  ['pascual', 'gonzalez'],
  ['santos', 'diaz'],
  ['mariano', 'diaz', 'tillard'],
  ['leonardo', 'rivadero']
]

const isSaturday = date => Boolean(date) && new Date(`${date}T12:00:00`).getDay() === 6

export const firstSaturdayOfYear = year => {
  const value = new Date(`${year}-01-01T12:00:00`)
  value.setDate(value.getDate() + ((6 - value.getDay() + 7) % 7))
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
}

export const nextSaturdayAfter = day => {
  const date = new Date(`${day}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + ((6 - date.getUTCDay() + 7) % 7 || 7))
  return date.toISOString().slice(0, 10)
}

const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
export const annualGuardEntryFor = technician => {
  const guardEligibleFrom = guardEligibility.guardEligibleFrom(technician)
  return { technicianId: technician.id, name: technician.name, ...(guardEligibleFrom ? { guardEligibleFrom } : {}) }
}

export const guardAssignmentRestriction = (technician, date, team) => {
  if (!guardAssignmentPolicy.isGuardTeam(date, team) || guardEligibility.guardEligibleOnDate(technician, date)) return ''
  const from = guardEligibility.guardEligibleFrom(technician)
  return `${technician.name} puede cubrir guardias desde el ${from.split('-').reverse().join('/')} (60 días desde su ingreso).`
}

export const defaultAnnualGuardRotation = technicians => {
  const remaining = [...monthlyEligibleTechnicians(technicians)]
  const preferred = DEFAULT_2026_GUARD_ROTATION.map(tokens => {
    const index = remaining.findIndex(technician => tokens.every(token => normalize(technician.name).includes(token)))
    return index < 0 ? null : remaining.splice(index, 1)[0]
  }).filter(Boolean)
  return [...preferred, ...remaining].map(annualGuardEntryFor)
}

// Suggestions for a year not yet configured keep the previous order while
// incorporating new technicians. Saved rotations remain authoritative.
export const suggestedAnnualGuardRotation = (year, weekly = {}, technicians = []) => {
  const configurations = weekly._annualGuards || {}
  if (Object.hasOwn(configurations, String(year))) return structuredClone(configurations[year]?.rotation || [])
  const previousYear = Object.keys(configurations).filter(value => /^\d{4}$/.test(value) && value < String(year)).sort().at(-1)
  const previous = configurations[previousYear]?.rotation || []
  const eligible = monthlyEligibleTechnicians(technicians)
  const selected = []
  const used = new Set()
  for (const entry of previous) {
    const technician = eligible.find(item => entry.technicianId != null
      ? String(item.id) === String(entry.technicianId)
      : normalize(item.name) === normalize(entry.name))
    if (!technician || used.has(String(technician.id))) continue
    selected.push(annualGuardEntryFor(technician)); used.add(String(technician.id))
  }
  return [...selected, ...defaultAnnualGuardRotation(eligible).filter(entry => !used.has(String(entry.technicianId)))]
}

export const annualGuardForDate = (date, weekly = {}) => guardRotation.guardForDate(date, weekly?._annualGuards?.[String(date).slice(0,4)])

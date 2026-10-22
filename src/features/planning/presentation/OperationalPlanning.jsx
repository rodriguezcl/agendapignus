import React, { useEffect, useRef, useState } from 'react'
import MonthlyHoursSettings from '../../../components/MonthlyHoursSettings.jsx'
import ModuleIntroduction from '../../../components/ModuleIntroduction.jsx'
import Icon from '../../../components/ui/Icon.jsx'
import TeamTechniciansField from '../../../components/TeamTechniciansField.jsx'
import VehicleResponsibilitySwap from '../../../components/VehicleResponsibilitySwap.jsx'
import { usePermissions } from '../../../presentation/contexts/permissions-context.jsx'
import { isGranular, normalizeRoleName } from '../../../domain/access/permissions.mjs'
import { currentLocalDate, prettyDate } from '../../../presentation/formatting.mjs'
import { createTeamId } from '../../../infrastructure/browser/identity.mjs'
import { useNationalHolidays } from '../../agenda/application/useNationalHolidays.js'
import { default2026GuardRotationFor, defaultServiceTasksForDate, isSaturday, assignGuardToEmptySaturday, weeklyTaskRemovalAliases, sortTasksByTime } from '../../agenda/application/agenda-model.mjs'
import { prepareVehicleControlGeneration, sameGeneratedVehicleControl } from '../../agenda/application/vehicle-control-generation.mjs'
import { ConfigurationHistoryPanel } from '../../agenda/presentation/AgendaFields.jsx'
import { monthlyTeamRotation, monthlyEligibleTechnicians } from '../../../domain/agenda/monthly-team-rotation.mjs'
import { synchronizeMonthlyTeams } from '../../../domain/agenda/monthly-team-sync.mjs'
import { synchronizeMonthlyVehicles } from '../../../domain/vehicles/monthly-vehicle-sync.mjs'
import { appendConfigurationHistory, teamConfigurationSnapshot, vehicleConfigurationSnapshot, guardConfigurationSnapshot } from '../../../domain/configuration/configuration-history.mjs'
import { suggestedVehicleAssignments, monthFridays, buildVehicleControlRecords, vehicleControlTask, vehicleLabel } from '../../../domain/vehicles/vehicle-controls.mjs'
import { firstSaturdayOfYear } from '../../../domain/agenda/annual-guards.mjs'
import { swapVehicleResponsibilities } from '../../state/application/vehicle-responsibility-swap.mjs'
import './operational-planning.css'

const TABS = [
  { key: 'weeklyHours', title: 'Horarios', icon: 'clock', read: 'weekly.monthlyHours.read', write: 'weekly.monthlyHours.manage' },
  { key: 'weeklyTeams', title: 'Equipos', icon: 'users', read: 'weekly.monthlyTeams.read', write: 'weekly.monthlyTeams.manage' },
  { key: 'weeklyVehicles', title: 'Asignación de flota', icon: 'vehicle', read: 'weekly.monthlyVehicles.read', write: 'weekly.monthlyVehicles.assign' },
  { key: 'weeklyGuards', title: 'Guardias', icon: 'users', read: 'weekly.guards.read', write: 'weekly.guards.manage' }
]
const signature = value => JSON.stringify(value ?? null)
const assertUnchanged = (latest, baseline, label) => {
  if (signature(latest) !== signature(baseline)) throw new Error(`Otra persona modificó ${label}. Descartá el borrador para revisar la versión actual.`)
}

export default function OperationalPlanning({ weekly = {}, activeTechs = [], vehicles = [], history = [], authUser, permissions = {}, persistWeeklyConfiguration, setNotice, initialPeriod, onReturnToAgenda, navigationGuardRef }) {
  const { can, user: permissionUser } = usePermissions()
  authUser = permissionUser || authUser || globalThis.__pignusCurrentUser || null
  const granular = isGranular(authUser)
  const readOnly = !granular && (authUser?.roleCode === 'operator' || normalizeRoleName(authUser?.role) === 'operador')
  const isAdministrator = authUser?.roleCode === 'administrator'
  const [today, setToday] = useState(currentLocalDate)
  const [monthKey, setMonthKey] = useState(() => /^\d{4}-\d{2}$/.test(initialPeriod || '') ? initialPeriod : currentLocalDate().slice(0, 7))
  const [guardYear, setGuardYear] = useState(() => monthKey.slice(0, 4))
  const pastMonthSelected = monthKey < today.slice(0, 7)
  const canReadConfiguration = key => {
    const tab = TABS.find(item => item.key === key)
    return granular ? can(tab.read) : !readOnly && (isAdministrator || Boolean(permissions[key]))
  }
  const canConfigureWeekly = key => {
    const tab = TABS.find(item => item.key === key)
    return !readOnly && (key === 'weeklyGuards' || !pastMonthSelected) && (granular ? can(tab.write) : isAdministrator || Boolean(permissions[key]))
  }
  const availableTabs = TABS.filter(tab => canReadConfiguration(tab.key))
  const [activeTab, setActiveTab] = useState(() => availableTabs[0]?.key || '')
  const availableTabKeys = availableTabs.map(tab => tab.key).join(',')
  const [monthlySetup, setMonthlySetup] = useState(null)
  const [monthlyVehicleSetup, setMonthlyVehicleSetup] = useState(null)
  const [annualGuardSetup, setAnnualGuardSetup] = useState(null)
  const [reload, setReload] = useState(0)
  const [saving, setSaving] = useState(false)
  const [childState, setChildState] = useState({ dirty: false, saving: false })
  const [leaveRequest, setLeaveRequest] = useState(null)
  const [error, setError] = useState('')
  const baselineRef = useRef({})
  const draftBaselineRef = useRef({})
  const busyRef = useRef(false)
  const childBusyRef = useRef(false)
  const guardStateRef = useRef({ dirty: false, busy: false })
  const monthlyTeams = weekly._monthlyTeams || {}
  const holidayCalendar = useNationalHolidays([monthKey.slice(0, 4)])
  const previousMonthKey = (() => { const value = new Date(`${monthKey}-01T12:00:00`); value.setMonth(value.getMonth() - 1); return value.toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' }).slice(0, 7) })()
  const priorVehicleAssignmentHistory = Object.entries(monthlyTeams).filter(([month, config]) => month < monthKey && config?.vehicleAssignments?.length).sort(([left], [right]) => left.localeCompare(right)).map(([, config]) => config.vehicleAssignments)
  const suggestedAnnualGuardRotation = year => {
    const configured = weekly._annualGuards?.[year]?.rotation
    if (configured?.length) return structuredClone(configured)
    if (String(year) === '2026') {
      const preset = default2026GuardRotationFor(activeTechs)
      if (preset.length) return preset
    }
    return structuredClone(weekly._annualGuards?.[String(Number(year) - 1)]?.rotation || [])
  }
  const createDay = (day, sourceWeekly = weekly) => {
    const sources = sourceWeekly._monthlyTeams?.[day.slice(0, 7)]?.teams || [null, null, null]
    const createTeam = (index, source) => ({ teamId: source?.teamId || createTeamId(), memberIds: source?.memberIds || [], members: source?.members || [], tasks: defaultServiceTasksForDate(day, sourceWeekly), label: source?.label || `Equipo ${index + 1}` })
    if (isSaturday(day)) {
      const stored = sourceWeekly[day]?.teams?.[0]
      const team = createTeam(0, stored ? { teamId: stored.teamId } : null)
      return { teams: assignGuardToEmptySaturday([{ ...team, memberIds: [], members: [], tasks: defaultServiceTasksForDate(day, sourceWeekly).slice(0, 1) }], day, sourceWeekly, activeTechs) }
    }
    return { teams: sources.map((source, index) => createTeam(index, source)) }
  }
  const requirePermission = key => {
    if (!readOnly && can(key)) return true
    setNotice('No tenés permiso para realizar esta acción.'); return false
  }
  const reportError = message => { setError(message); setNotice(message) }
  const calendarReady = () => {
    if (!holidayCalendar.loading && !holidayCalendar.error) return true
    reportError(holidayCalendar.error ? 'No se pudo verificar el calendario de feriados. Intentá nuevamente antes de generar controles.' : 'Esperá mientras se verifican los feriados nacionales.')
    return false
  }
  const beginSave = () => { busyRef.current = true; setSaving(true); setError('') }
  const endSave = () => { busyRef.current = false; setSaving(false) }
  const reloadDrafts = () => { setError(''); setReload(value => value + 1) }
  const handleChildState = React.useCallback(state => { childBusyRef.current = state.saving; setChildState(state) }, [])
  const busy = saving || childState.saving
  const ownDirty = activeTab === 'weeklyTeams' ? signature(monthlySetup) !== draftBaselineRef.current.teams
    : activeTab === 'weeklyVehicles' ? signature(monthlyVehicleSetup) !== draftBaselineRef.current.assignments
      : activeTab === 'weeklyGuards' ? signature(annualGuardSetup) !== draftBaselineRef.current.rotation : false
  const dirty = activeTab === 'weeklyHours' ? childState.dirty : Boolean((monthlySetup || monthlyVehicleSetup || annualGuardSetup) && ownDirty)
  guardStateRef.current = { dirty, busy }
  useEffect(() => {
    if (availableTabs.some(tab => tab.key === activeTab)) return
    guardStateRef.current = { dirty: false, busy: false }
    setLeaveRequest(null)
    setActiveTab(availableTabs[0]?.key || '')
  }, [availableTabKeys, activeTab])
  const requestLeave = continuation => {
    if (busyRef.current || childBusyRef.current) { setNotice('Esperá a que termine el guardado.'); return }
    if (guardStateRef.current.dirty) { setLeaveRequest(() => continuation); return }
    continuation()
  }
  useEffect(() => {
    const guard = continuation => requestLeave(continuation)
    guard.hasDraft = () => guardStateRef.current.dirty || guardStateRef.current.busy || busyRef.current || childBusyRef.current
    if (navigationGuardRef) navigationGuardRef.current = guard
    const beforeUnload = event => { if (guard.hasDraft()) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', beforeUnload)
    return () => {
      if (navigationGuardRef?.current === guard) navigationGuardRef.current = null
      window.removeEventListener('beforeunload', beforeUnload)
    }
  }, [navigationGuardRef])
  useEffect(() => {
    const timer = window.setInterval(() => setToday(currentLocalDate()), 60_000)
    return () => window.clearInterval(timer)
  }, [])
  useEffect(() => {
    const config = monthlyTeams[monthKey] || {}
    const teams = config.teams ? config.teams.map(team => ({ teamId: team.teamId || createTeamId(), label: team.label, memberIds: [...(team.memberIds || [])], members: [...(team.members || [])] })) : pastMonthSelected ? [] : suggestedMonthlyTeams()
    const saved = config.vehicleAssignments
    const savedMatchesFleet = saved?.length === vehicles.length && vehicles.every(vehicle => saved.some(item => String(item.vehicleId) === String(vehicle.id)))
    const assignments = savedMatchesFleet || pastMonthSelected ? structuredClone(saved || []) : suggestedVehicleAssignments(vehicles, teams, { month: monthKey, assignmentHistory: priorVehicleAssignmentHistory })
    const teamDraft = { month: monthKey, teams }
    const vehicleDraft = { month: monthKey, assignments }
    const guardDraft = annualGuardDraft(guardYear)
    baselineRef.current = { teams: structuredClone(config.teams), assignments: structuredClone(saved), rotation: structuredClone(weekly._annualGuards?.[guardYear]?.rotation) }
    draftBaselineRef.current = { teams: signature(teamDraft), assignments: signature(vehicleDraft), rotation: signature(guardDraft) }
    setMonthlySetup(teamDraft); setMonthlyVehicleSetup(vehicleDraft); setAnnualGuardSetup(guardDraft)
    setChildState({ dirty: false, saving: false }); setError('')
  }, [monthKey, guardYear, activeTab, reload])

  const suggestedMonthlyTeams = () => {
    const rotation = monthlyTeamRotation(monthlyEligibleTechnicians(activeTechs), monthKey, '2026-01', vehicles.length || 3)
    if (rotation.length) return rotation.map((members, index) => ({ teamId: createTeamId(), label: `Equipo ${index + 1}`, memberIds: members.map(tech => tech.id), members: members.map(tech => tech.name) }))
    return (monthlyTeams[previousMonthKey]?.teams || [null, null, null]).map((team, index) => ({ teamId: team?.teamId || createTeamId(), label: team?.label || `Equipo ${index + 1}`, memberIds: team?.memberIds || [], members: team?.members || [] }))
  }
  const updateMonthlyTeam = (index, memberIds) => { const selected = activeTechs.filter(tech => memberIds.some(id => String(id) === String(tech.id))); setMonthlySetup(previous => ({ ...previous, teams: previous.teams.map((team, teamIndex) => teamIndex === index ? { ...team, memberIds: selected.map(tech => tech.id), members: selected.map(tech => tech.name) } : team) })) }
  const addMonthlyTeam = () => setMonthlySetup(previous => ({ ...previous, teams: [...previous.teams, { teamId: createTeamId(), label: `Equipo ${previous.teams.length + 1}`, memberIds: [], members: [] }] }))
  const saveMonthlySetup = async () => {
    if (!canConfigureWeekly('weeklyTeams') || busyRef.current) return
    const eligibleIds = new Set(monthlyEligibleTechnicians(activeTechs).map(tech => String(tech.id)))
    const assignedIds = monthlySetup.teams.flatMap(team => (team.memberIds || []).map(String))
    if (assignedIds.some(id => !eligibleIds.has(id))) { setNotice('Los equipos mensuales solo pueden incluir colaboradores activos con rol Técnico.'); return }
    if (new Set(assignedIds).size !== assignedIds.length) { setNotice('Cada técnico debe integrar un único equipo mensual.'); return }
    if (!granular && vehicles.length && !canConfigureWeekly('weeklyVehicles')) { setNotice('Para sincronizar equipos y vehículos necesitás también el permiso de asignación de flota.'); return }
    const month = monthlySetup.month
    const teams = structuredClone(monthlySetup.teams)
    if (vehicles.length && (!granular || (can('weekly.monthlyVehicles.assign') && can('weekly.controls.schedule'))) && !calendarReady()) return
    beginSave()
    try {
      await persistWeeklyConfiguration(snapshot => {
        const current = snapshot.agenda?.weekly?._monthlyTeams?.[month] || {}
        assertUnchanged(current.teams, baselineRef.current.teams, 'los equipos')
        assertUnchanged(current.vehicleAssignments, baselineRef.current.assignments, 'la asignación de flota')
        const signature = value => JSON.stringify((value || []).map(team => (team.memberIds || []).map(String).sort()))
        const changed = signature(current.teams) !== signature(teams)
        let next = synchronizeMonthlyTeams(snapshot, { month, teams, fromDate: today })
        if (vehicles.length && (!granular || (can('weekly.monthlyVehicles.assign') && can('weekly.controls.schedule')))) next = synchronizeMonthlyVehicles(next, { month, teams, vehicles, technicians: activeTechs, fromDate: today, holidays: holidayCalendar.records })
        const config = next.agenda.weekly._monthlyTeams?.[month] || {}
        let configurationHistory = appendConfigurationHistory(current.configurationHistory, {
          type: 'teams', period: month, before: teamConfigurationSnapshot(current.teams), after: teamConfigurationSnapshot(teams), user: authUser
        })
        if (changed && vehicles.length && (!granular || (can('weekly.monthlyVehicles.assign') && can('weekly.controls.schedule')))) configurationHistory = appendConfigurationHistory(configurationHistory, {
          type: 'vehicles', period: month, before: vehicleConfigurationSnapshot(current.vehicleAssignments, vehicles, activeTechs), after: vehicleConfigurationSnapshot(config.vehicleAssignments, vehicles, activeTechs), user: authUser
        })
        next.agenda.weekly._monthlyTeams = { ...next.agenda.weekly._monthlyTeams, [month]: { ...config, teams, configurationHistory } }
        return next
      })
      reloadDrafts()
      setNotice('Equipos guardados correctamente.')
    } catch (error) { reportError(`No se guardaron los equipos. ${error.message || 'Revisá la configuración e intentá nuevamente.'}`) }
    finally { endSave() }
  }
  const updateMonthlyVehicleAssignment = (vehicleId, technicianId) => setMonthlyVehicleSetup(previous => ({
    ...previous,
    assignments: previous.assignments.map(item => String(item.vehicleId) === String(vehicleId) ? { ...item, technicianId } : item)
  }))
  const updateVehicleControlOverride = (vehicleId, friday, technicianId) => setMonthlyVehicleSetup(previous => ({
    ...previous,
    assignments: previous.assignments.map(item => {
      if (String(item.vehicleId) !== String(vehicleId)) return item
      const weeklyOverrides = { ...(item.weeklyOverrides || {}) }
      if (!technicianId || String(technicianId) === String(item.technicianId)) delete weeklyOverrides[friday]
      else weeklyOverrides[friday] = technicianId
      return { ...item, weeklyOverrides }
    })
  }))
  const saveMonthlyVehicleSetup = async (scheduleOnly = false) => {
    if (busyRef.current || pastMonthSelected || (scheduleOnly ? !requirePermission('weekly.controls.schedule') : !canConfigureWeekly('weeklyVehicles'))) return
    const generateControls = !granular || scheduleOnly
    if (generateControls && !calendarReady()) return
    if (scheduleOnly && !monthlyTeams[monthlyVehicleSetup?.month]?.vehicleAssignments?.length) { setNotice('Guardá primero una asignación mensual válida antes de generar controles.'); return }
    const assignments = (scheduleOnly ? monthlyTeams[monthlyVehicleSetup?.month]?.vehicleAssignments : monthlyVehicleSetup?.assignments) || []
    const teams = monthlyTeams[monthlyVehicleSetup?.month]?.teams || suggestedMonthlyTeams()
    if (assignments.length !== vehicles.length || vehicles.some(vehicle => !assignments.some(item => String(item.vehicleId) === String(vehicle.id) && item.technicianId))) { setNotice('Asigná un técnico responsable a cada vehículo.'); return }
    if (activeTechs.length >= vehicles.length && new Set(assignments.map(item => String(item.technicianId))).size !== assignments.length) { setNotice('Cada vehículo debe tener un técnico responsable diferente.'); return }
    const duplicatedOverride = monthFridays(monthlyVehicleSetup.month).filter(friday => friday >= today).find(friday => {
      const technicians = assignments.map(item => String(item.weeklyOverrides?.[friday] || item.technicianId || '')).filter(Boolean)
      return activeTechs.length >= vehicles.length && new Set(technicians).size !== technicians.length
    })
    if (duplicatedOverride) { setNotice(`El ${prettyDate(duplicatedOverride)} un técnico quedó asignado a más de un control a las 15:45. Elegí responsables diferentes.`); return }
    const soloTechnicianIds = teams.filter(team => (team.memberIds || []).length === 1).map(team => String(team.memberIds[0]))
    const fordKa = vehicles.find(vehicle => String(vehicle.brand || '').toLowerCase().includes('ford') && /(^|\s)ka($|\s)/i.test(String(vehicle.model || '')))
    const fordAssignment = fordKa && assignments.find(item => String(item.vehicleId) === String(fordKa.id))
    if (fordKa && soloTechnicianIds.length && !soloTechnicianIds.includes(String(fordAssignment?.technicianId || ''))) { setNotice('El Ford Ka debe quedar asignado a uno de los técnicos que trabaja solo durante el mes.'); return }
    const assignmentSnapshot = vehicleConfigurationSnapshot(assignments, vehicles, activeTechs)
    const persistedAssignments = assignments.map(assignment => {
      const snapshot = assignmentSnapshot.find(item => String(item.vehicleId) === String(assignment.vehicleId))
      return { ...assignment, vehicle: snapshot?.vehicle || '', technician: snapshot?.technician || '' }
    })
    const records = buildVehicleControlRecords({ month: monthlyVehicleSetup.month, assignments: persistedAssignments, vehicles, technicians: activeTechs, teams, fromDate: today, holidays: holidayCalendar.records, holidayOverrides: weekly._holidayOverrides || {} })
      .filter(record => !weeklyTaskRemovalAliases(vehicleControlTask(record)).some(alias => (weekly?.[record.date]?.removedTaskIds || []).includes(alias)))
    const updateWeekly = (previous, generatedControls = []) => {
      let next = { ...previous }
      if (generateControls) Object.entries(next).forEach(([day, plan]) => {
        if (day.startsWith('_') || !plan?.teams) return
        next[day] = {
          ...plan,
          teams: plan.teams.map(team => ({
            ...team,
            tasks: (team.tasks || []).filter(task => !generatedControls.some(record => sameGeneratedVehicleControl(task, record, day)))
          }))
        }
      })
      if (generateControls) generatedControls.forEach(record => {
        const plan = next[record.date] || createDay(record.date, next)
        let teamIndex = plan.teams.findIndex(team => (team.memberIds || []).some(id => String(id) === String(record.technicianIds[0])))
        if (teamIndex < 0) teamIndex = 0
        next[record.date] = {
          ...plan,
          teams: plan.teams.map((team, index) => index === teamIndex
            ? { ...team, tasks: sortTasksByTime([...(team.tasks || []).filter(task => String(task.historyId || '') !== String(record.id)), vehicleControlTask(record)]) }
            : team)
        }
      })
      if (scheduleOnly) return next
      return {
        ...next,
        _monthlyTeams: {
          ...(next._monthlyTeams || {}),
          [monthlyVehicleSetup.month]: (() => {
            const current = next._monthlyTeams?.[monthlyVehicleSetup.month] || {}
            const configurationHistory = appendConfigurationHistory(current.configurationHistory, {
              type: 'vehicles',
              period: monthlyVehicleSetup.month,
              before: vehicleConfigurationSnapshot(current.vehicleAssignments, vehicles, activeTechs),
              after: assignmentSnapshot,
              user: authUser
            })
            return { ...current, ...(!granular ? { teams } : {}), vehicleAssignments: persistedAssignments, configurationHistory }
          })()
        }
      }
    }
    beginSave()
    try {
      await persistWeeklyConfiguration(snapshot => {
        const latest = snapshot.agenda?.weekly?._monthlyTeams?.[monthlyVehicleSetup.month] || {}
        assertUnchanged(latest.vehicleAssignments, baselineRef.current.assignments, 'la asignación de flota')
        assertUnchanged(latest.teams, baselineRef.current.teams, 'los equipos')
        const generated = generateControls ? prepareVehicleControlGeneration(snapshot, records, today) : { records: [], history: snapshot.history || [] }
        return {
          ...snapshot,
          history: generated.history,
          agenda: { ...snapshot.agenda, weekly: updateWeekly(snapshot.agenda?.weekly || {}, generated.records) }
        }
      })
      reloadDrafts()
      setNotice(generateControls ? 'Se generaron los controles con los responsables confirmados.' : 'Se guardaron los responsables mensuales.')
    } catch (error) {
      reportError(`No se guardaron los responsables. ${error.message || 'Revisá la versión actual e intentá nuevamente.'}`)
    } finally { endSave() }
  }
  const annualGuardDraft = year => ({ year: String(year), rotation: /^\d{4}$/.test(String(year)) ? suggestedAnnualGuardRotation(String(year)) : [] })
  const updateAnnualGuardTechnician = (index, technicianId) => {
    const technician = activeTechs.find(item => String(item.id) === String(technicianId))
    if (!technician) return
    setAnnualGuardSetup(previous => ({ ...previous, rotation: previous.rotation.map((item, itemIndex) => itemIndex === index ? { technicianId: technician.id, name: technician.name } : item) }))
  }
  const addAnnualGuardTechnician = () => {
    const available = activeTechs.find(tech => !annualGuardSetup.rotation.some(item => String(item.technicianId) === String(tech.id))) || activeTechs[0]
    if (!available) return
    setAnnualGuardSetup(previous => ({ ...previous, rotation: [...previous.rotation, { technicianId: available.id, name: available.name }] }))
  }
  const moveAnnualGuardTechnician = (index, direction) => setAnnualGuardSetup(previous => {
    const destination = index + direction
    if (destination < 0 || destination >= previous.rotation.length) return previous
    const rotation = [...previous.rotation]
    ;[rotation[index], rotation[destination]] = [rotation[destination], rotation[index]]
    return { ...previous, rotation }
  })
  const removeAnnualGuardTechnician = index => setAnnualGuardSetup(previous => ({ ...previous, rotation: previous.rotation.filter((_, itemIndex) => itemIndex !== index) }))
  const saveAnnualGuardSetup = async () => {
    if (!canConfigureWeekly('weeklyGuards') || busyRef.current) return
    const rotation = annualGuardSetup?.rotation || []
    const duplicated = new Set(rotation.map(item => String(item.technicianId || item.name))).size !== rotation.length
    if (!/^\d{4}$/.test(annualGuardSetup?.year || '') || !rotation.length || duplicated) return
    const year = annualGuardSetup.year
    beginSave()
    try {
      await persistWeeklyConfiguration(snapshot => {
        const previous = snapshot.agenda?.weekly || {}
        const current = previous._annualGuards?.[year] || {}
        assertUnchanged(current.rotation, baselineRef.current.rotation, 'las guardias')
        const configurationHistory = appendConfigurationHistory(current.configurationHistory, {
          type: 'guards', period: year, before: guardConfigurationSnapshot(current.rotation),
          after: guardConfigurationSnapshot(rotation), user: authUser
        })
        return { ...snapshot, agenda: { ...snapshot.agenda, weekly: { ...previous,
          _annualGuards: { ...(previous._annualGuards || {}),
            [year]: { ...current, startDate: firstSaturdayOfYear(year), rotation, configurationHistory }
          }
        } } }
      })
      reloadDrafts()
      setNotice(`El cronograma de guardias de ${year} fue guardado.`)
    } catch (error) { reportError(`No se guardaron las guardias. ${error.message || 'Intentá nuevamente.'}`) }
    finally { endSave() }
  }


  const selectPeriod = value => {
    if (!/^\d{4}-\d{2}$/.test(value) || value === monthKey) return
    requestLeave(() => { setMonthKey(value); setGuardYear(value.slice(0, 4)) })
  }
  const currentTab = availableTabs.find(tab => tab.key === activeTab)
  const validYear = /^\d{4}$/.test(annualGuardSetup?.year || '')
  const duplicatedGuard = annualGuardSetup && new Set(annualGuardSetup.rotation.map(item => String(item.technicianId || item.name))).size !== annualGuardSetup.rotation.length
  const panelActions = (label, onSave, disabled = false) => <div className="planning-form-actions">
    {dirty && <button type="button" className="secondary" disabled={busy} onClick={() => requestLeave(reloadDrafts)}>Descartar cambios</button>}
    <button type="button" className="primary" disabled={busy || disabled} onClick={onSave}><Icon name="check" size={16} />{saving ? 'Guardando…' : label}</button>
  </div>
  return <div className="operational-planning">
    <ModuleIntroduction><p className="eyebrow">RECURSOS</p><h1>Planificación operativa</h1></ModuleIntroduction>
    <div className="planning-toolbar">
      <label>Mes de planificación<input type="month" value={monthKey} disabled={busy} onChange={event => selectPeriod(event.target.value)} /></label>
      {onReturnToAgenda && <button type="button" className="secondary" disabled={busy} onClick={() => onReturnToAgenda({ month: monthKey })}><Icon name="calendar" size={16} />Ver agenda semanal</button>}
    </div>
    {!availableTabs.length ? <p>No tenés permisos para consultar la planificación operativa.</p> : <>
      <div className="planning-tabs" role="tablist" aria-label="Planificación de recursos">
        {availableTabs.map(tab => <button type="button" key={tab.key} id={`planning-tab-${tab.key}`} role="tab" aria-selected={activeTab === tab.key} aria-controls={`planning-panel-${tab.key}`} className={activeTab === tab.key ? 'active' : ''} disabled={busy} onClick={() => { if (tab.key !== activeTab) requestLeave(() => setActiveTab(tab.key)) }}><Icon name={tab.icon} size={18} />{tab.title}</button>)}
      </div>
      {currentTab && <section className="planning-panel" role="tabpanel" id={`planning-panel-${activeTab}`} aria-labelledby={`planning-tab-${activeTab}`} aria-busy={busy}>
        {pastMonthSelected && activeTab !== 'weeklyGuards' && <p className="planning-period-note">Este mes finalizó. La configuración es de solo lectura.</p>}
        {error && <p className="field-error" role="alert">{error}</p>}
        {activeTab === 'weeklyHours' && <MonthlyHoursSettings key={`${monthKey}-${reload}`} month={monthKey} weekly={weekly} persistWeeklyConfiguration={persistWeeklyConfiguration} setNotice={setNotice} onClose={reloadDrafts} embedded onDraftStateChange={handleChildState} onDiscard={() => requestLeave(reloadDrafts)} />}
        {activeTab === 'weeklyTeams' && monthlySetup && <>
          <header className="planning-panel-heading"><h2>Equipos del mes</h2><p>Se mantienen las excepciones diarias, las guardias y los equipos con trabajos iniciados o cerrados.</p></header>
          {!monthlyTeams[monthKey]?.teams?.length && !pastMonthSelected && <p className="planning-period-note">Distribución sugerida. Guardá los equipos para confirmar la planificación del mes.</p>}
          <details className="monthly-team-help"><summary>Cómo se distribuyen los equipos</summary><p>La rotación mensual incluye a los colaboradores con rol Técnico. Los perfiles con función técnica adicional se asignan puntualmente. Los cambios se aplican desde hoy a los equipos pendientes que conservan la dotación mensual.</p></details>
          <fieldset className="planning-editable-fields" disabled={!canConfigureWeekly('weeklyTeams') || busy}>
            <div className="monthly-team-list">{monthlySetup.teams.map((team, index) => <TeamTechniciansField key={team.teamId || index} label={team.label || `Equipo ${index + 1}`} technicians={monthlyEligibleTechnicians(activeTechs)} memberIds={team.memberIds || []} onChange={memberIds => updateMonthlyTeam(index, memberIds)} />)}</div>
            {canConfigureWeekly('weeklyTeams') && <button type="button" className="secondary monthly-add-team" onClick={addMonthlyTeam}><Icon name="plus" size={15} />Agregar equipo</button>}
          </fieldset>
          {!monthlySetup.teams.length && <p>No hay equipos configurados para este mes.</p>}
          <ConfigurationHistoryPanel history={monthlyTeams[monthKey]?.configurationHistory} type="teams" />
          {canConfigureWeekly('weeklyTeams') && panelActions('Guardar equipos del mes', saveMonthlySetup)}
        </>}
        {activeTab === 'weeklyVehicles' && monthlyVehicleSetup && <>
          <header className="planning-panel-heading"><h2>Asignación de flota</h2><p>Responsables mensuales y reemplazos para los controles de cada viernes.</p></header>
          {!vehicles.length ? <p>Primero cargá los vehículos en el módulo Flota.</p> : <>
            {!monthlyTeams[monthKey]?.vehicleAssignments?.length && !pastMonthSelected && <p className="planning-period-note">La asignación del mes todavía no está confirmada. Revisá y guardá los responsables.</p>}
            <details className="monthly-team-help"><summary>Cómo se programan los controles</summary><p>Los controles duran 15 minutos y se programan los viernes a las 15:45. Cada responsable informa el kilometraje y adjunta la foto interior. Los reemplazos por fecha no modifican la asignación del resto del mes.</p></details>
            <VehicleResponsibilitySwap key={`${monthKey}-${reload}`} month={monthKey} today={today} vehicles={vehicles} history={history} disabled={busy || !canConfigureWeekly('weeklyVehicles') || signature(monthlyVehicleSetup.assignments) !== signature(monthlyTeams[monthKey]?.vehicleAssignments || [])} onBusyChange={value => { childBusyRef.current = value; setChildState(previous => ({ ...previous, saving: value })) }} onSave={async command => {
              if (!canConfigureWeekly('weeklyVehicles')) throw new Error('No tenés permiso para cambiar responsables vehiculares.')
              await persistWeeklyConfiguration(snapshot => swapVehicleResponsibilities(snapshot, { ...command, today: currentLocalDate(), user: authUser }))
              reloadDrafts()
              setNotice('Responsables intercambiados sólo para el viernes elegido. Se conservó la asignación mensual.')
            }} />
            <fieldset className="planning-editable-fields" disabled={!canConfigureWeekly('weeklyVehicles') || busy}>
              <div className="monthly-vehicle-list">{vehicles.map(vehicle => {
                const assignment = monthlyVehicleSetup.assignments.find(item => String(item.vehicleId) === String(vehicle.id))
                const futureFridays = monthFridays(monthKey).filter(friday => friday >= today)
                return <div className="monthly-vehicle-assignment" key={vehicle.id}>
                  <label><span><b>{vehicleLabel(vehicle)}</b><small>Kilometraje actual: {Number(vehicle.mileage || 0).toLocaleString('es-AR')} km</small></span><select value={assignment?.technicianId || ''} onChange={event => updateMonthlyVehicleAssignment(vehicle.id, event.target.value)}><option value="">Seleccionar responsable</option>{activeTechs.map(tech => <option key={tech.id} value={tech.id}>{tech.name}</option>)}</select></label>
                  {futureFridays.length > 0 && assignment?.technicianId && <details className="vehicle-control-overrides"><summary>Reemplazos por contingencia</summary>{futureFridays.map(friday => <label key={friday}><span><b>{prettyDate(friday)}</b><small>{assignment.weeklyOverrides?.[friday] ? 'Reemplazo excepcional' : 'Responsable mensual'}</small></span><select value={assignment.weeklyOverrides?.[friday] || assignment.technicianId} onChange={event => updateVehicleControlOverride(vehicle.id, friday, event.target.value)}>{activeTechs.map(tech => <option key={tech.id} value={tech.id}>{tech.name}</option>)}</select></label>)}</details>}
                </div>
              })}</div>
            </fieldset>
            <ConfigurationHistoryPanel history={monthlyTeams[monthKey]?.configurationHistory} type="vehicles" />
            <div className="planning-vehicle-actions">
              {canConfigureWeekly('weeklyVehicles') && panelActions('Guardar responsables', () => saveMonthlyVehicleSetup(false))}
              {granular && can('weekly.controls.schedule') && !pastMonthSelected && <button type="button" className="secondary" disabled={busy || dirty || !monthlyTeams[monthKey]?.vehicleAssignments?.length} title="Generá controles con la asignación mensual guardada." onClick={() => saveMonthlyVehicleSetup(true)}>Generar controles</button>}
            </div>
          </>}
        </>}
        {activeTab === 'weeklyGuards' && annualGuardSetup && <>
          <header className="planning-panel-heading"><h2>Guardias de fin de semana</h2><p>El orden de rotación se repite cada sábado del año. Las excepciones diarias se conservan.</p></header>
          <label className="annual-guard-year">Año<input type="number" min="2026" max="2100" value={guardYear} disabled={busy} onChange={event => { const value = event.target.value; requestLeave(() => setGuardYear(value)) }} /></label>
          <fieldset className="planning-editable-fields" disabled={!canConfigureWeekly('weeklyGuards') || busy}>
            <div className="annual-guard-list">{annualGuardSetup.rotation.map((guard, index) => {
              const legacyGuard = guard.name && !activeTechs.some(tech => String(tech.id) === String(guard.technicianId))
              return <div className="annual-guard-row" key={`${guard.technicianId || guard.name}-${index}`}><span>{index + 1}</span><select aria-label={`Técnico ${index + 1} de la rotación`} value={guard.technicianId || ''} onChange={event => updateAnnualGuardTechnician(index, event.target.value)}>{legacyGuard && <option value={guard.technicianId || ''}>{guard.name} (no activo)</option>}{activeTechs.map(tech => <option key={tech.id} value={tech.id}>{tech.name}</option>)}</select><button type="button" className="secondary" aria-label={`Subir a ${guard.name}`} disabled={index === 0} onClick={() => moveAnnualGuardTechnician(index, -1)}>↑</button><button type="button" className="secondary" aria-label={`Bajar a ${guard.name}`} disabled={index === annualGuardSetup.rotation.length - 1} onClick={() => moveAnnualGuardTechnician(index, 1)}>↓</button><button type="button" className="icon-btn delete" aria-label={`Quitar a ${guard.name}`} onClick={() => removeAnnualGuardTechnician(index)}><Icon name="trash" size={15} /></button></div>
            })}</div>
            {canConfigureWeekly('weeklyGuards') && <button type="button" className="secondary annual-guard-add" disabled={!activeTechs.length || !validYear} onClick={addAnnualGuardTechnician}><Icon name="plus" size={15} />Agregar técnico</button>}
          </fieldset>
          {!validYear && <p className="field-error">Ingresá un año válido.</p>}
          {duplicatedGuard && <p className="field-error">Cada técnico puede aparecer una sola vez en la rotación.</p>}
          {validYear && !annualGuardSetup.rotation.length && <p>No hay técnicos en la rotación de este año.</p>}
          <ConfigurationHistoryPanel history={weekly._annualGuards?.[guardYear]?.configurationHistory} type="guards" />
          {canConfigureWeekly('weeklyGuards') && panelActions('Guardar guardias del año', saveAnnualGuardSetup, !validYear || !annualGuardSetup.rotation.length || duplicatedGuard)}
        </>}
      </section>}
    </>}
    {leaveRequest && <div className="modal-layer"><section className="modal confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="planning-unsaved-title"><h2 id="planning-unsaved-title">Cambios sin guardar</h2><p>Tenés cambios en la planificación. Guardalos antes de salir o descartá el borrador para continuar.</p><div className="confirm-actions"><button type="button" className="secondary" onClick={() => setLeaveRequest(null)}>Seguir editando</button><button type="button" className="danger-button" onClick={() => { const continuation = leaveRequest; guardStateRef.current = { dirty: false, busy: false }; setLeaveRequest(null); continuation() }}>Descartar y continuar</button></div></section></div>}
  </div>
}

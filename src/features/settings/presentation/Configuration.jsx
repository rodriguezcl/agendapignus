import React, { useEffect, useState } from 'react'
import { usePermissions } from '../../../presentation/contexts/permissions-context.jsx'
import { requestJson } from '../../../infrastructure/http/json-request.mjs'
import TicketSettings from '../../tickets/TicketSettings.jsx'
import TicketMailSettings from '../../tickets/TicketMailSettings.jsx'
import { FrozenMonthsSettings } from '../../../components/FrozenMonths.jsx'
import WorkdaySettings from '../../../components/WorkdaySettings.jsx'
import Settings from './Settings.jsx'
import './configuration.css'

function SupportMailConfiguration() {
  const [areas, setAreas] = useState(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let current = true
    setError('')
    requestJson('/api/tickets/config').then(result => {
      if (current) setAreas(result.config.areas || [])
    }).catch(failure => { if (current) setError(failure.message) })
    return () => { current = false }
  }, [attempt])
  return <div className="data-card tickets-settings support-mail-configuration">
    {error ? <div role="alert"><p className="field-error">{error}</p><button type="button" className="secondary" onClick={() => setAttempt(value => value + 1)}>Reintentar</button></div>
      : areas ? <TicketMailSettings areas={areas} /> : <p role="status">Cargando configuración de correo…</p>}
  </div>
}

export default function Configuration({ canConfigureFrozenMonths = false, canConfigureWorkday = false, onNavigate, ...props }) {
  const { can } = usePermissions()
  const { weekly, persistWeeklyConfiguration, setNotice } = props
  const tabs = [
    { id: 'tickets', label: 'Tickets', allowed: can('tickets.configure') },
    { id: 'mail', label: 'Correo de soporte', allowed: can('tickets.configure') },
    { id: 'frozen', label: 'Meses congelados', allowed: canConfigureFrozenMonths },
    { id: 'workday', label: 'Jornada laboral', allowed: canConfigureWorkday },
    { id: 'roles', label: 'Roles', allowed: can('settings.roles.read') },
  ].filter(tab => tab.allowed)
  const [selected, setSelected] = useState(() => tabs[0]?.id)
  const active = tabs.some(tab => tab.id === selected) ? selected : tabs[0]?.id
  const select = id => {
    if (id === active) return
    onNavigate(() => {
      setSelected(id)
      document.getElementById(`configuration-tab-${id}`)?.focus()
    })
  }
  const navigateTabs = event => {
    const index = tabs.findIndex(tab => `configuration-tab-${tab.id}` === event.target.id)
    if (index < 0) return
    const next = { ArrowRight: (index + 1) % tabs.length, ArrowLeft: (index + tabs.length - 1) % tabs.length, Home: 0, End: tabs.length - 1 }[event.key]
    if (next === undefined) return
    event.preventDefault()
    document.getElementById(`configuration-tab-${tabs[next].id}`)?.focus()
  }
  if (!active) return <p>No tenés permisos para consultar la configuración.</p>
  return <div className="configuration-page">
    <div className="configuration-tabs" role="tablist" aria-label="Secciones de configuración" onKeyDown={navigateTabs}>
      {tabs.map(tab => <button type="button" key={tab.id} id={`configuration-tab-${tab.id}`} role="tab" aria-selected={active === tab.id} aria-controls={`configuration-panel-${tab.id}`} tabIndex={active === tab.id ? 0 : -1} onClick={() => select(tab.id)}>{tab.label}</button>)}
    </div>
    {tabs.map(tab => <section key={tab.id} hidden={active !== tab.id} className="configuration-panel" role="tabpanel" id={`configuration-panel-${tab.id}`} aria-labelledby={`configuration-tab-${tab.id}`} tabIndex={0}>
      {active === tab.id && <>
      {active === 'tickets' && <TicketSettings />}
      {active === 'mail' && <SupportMailConfiguration />}
      {active === 'frozen' && <FrozenMonthsSettings options={weekly?._frozenMonthOptions ?? [4, 6]} onSave={options => persistWeeklyConfiguration(snapshot => ({ ...snapshot, agenda: { ...snapshot.agenda, weekly: { ...snapshot.agenda?.weekly, _frozenMonthOptions: options } } }))} />}
      {active === 'workday' && <WorkdaySettings {...{ weekly, persistWeeklyConfiguration, setNotice }} canManage={can('settings.workday.manage')} />}
      {active === 'roles' && <Settings {...props} />}
      </>}
    </section>)}
  </div>
}

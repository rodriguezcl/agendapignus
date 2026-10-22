import React, { useEffect, useMemo, useState } from 'react'
import { CATALOG, PERMISSION_GROUPS, BY_ID, roleCode, isGranular, toGranularPermissions, dependencyReason, togglePermission, readScope, writeScope } from '../../../domain/access/permissions.mjs'
import { canDelegateRole } from '../../../domain/access/role-delegation.mjs'
import { usePermissions } from '../../../presentation/contexts/permissions-context.jsx'
import WorkdaySettings from '../../../components/WorkdaySettings.jsx'
import ModuleIntroduction from '../../../components/ModuleIntroduction.jsx'
import Icon from '../../../components/ui/Icon.jsx'
import RolePreview from './RolePreview.jsx'
import './role-permissions.css'

const blankPermissions = () => ({ __catalogV2: true, ...Object.fromEntries(CATALOG.map(item => [item.id, false])) })
const clone = value => JSON.parse(JSON.stringify(value))
const scopeFields = [
  ['scope.services.read', 'Servicios que puede consultar', ['all', 'assigned', 'cctv']],
  ['scope.services.write', 'Servicios sobre los que puede actuar', ['all', 'assigned', 'cctv']],
  ['scope.customers.read', 'Clientes que puede consultar', ['all', 'related', 'cctv']]
]
const scopeLabels = { all: 'Todos los autorizados', assigned: 'Sólo asignados', cctv: 'Sólo clientes con seguimiento CCTV', related: 'Sólo vinculados a sus servicios', none: 'Sin acceso: corregir alcance' }

export default function Settings({ roles, employees = [], setRoles, setNotice, ask, weekly, persistWeeklyConfiguration, persistRole, roleBaseline, canConfigureWorkday = false }) {
  const { can, user } = usePermissions()
  const [active, setActive] = useState(roles[0]?.id)
  const [module, setModule] = useState('weekly')
  const [draft, setDraft] = useState(null)
  const [baseline, setBaseline] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [impact, setImpact] = useState('')
  const [preview, setPreview] = useState(null)
  const selected = roles.find(role => String(role.id) === String(active)) || roles[0]
  const displayed = draft || selected
  const permissions = useMemo(() => displayed ? toGranularPermissions({ ...displayed, technicalEnabled: employees.some(employee => String(employee.roleId) === String(displayed.id) && employee.technicalEnabled === true) }) : blankPermissions(), [displayed, employees])
  const protectedRole = roleCode(displayed) === 'administrator'
  const canChangePermissions = can('settings.roles.permissions') && !protectedRole
  const canChangeIdentity = draft?.isNew ? can('settings.roles.create') : can('settings.roles.edit')
  const items = CATALOG.filter(item => !item.hidden && item.groups.includes(module))
  const dirty = Boolean(draft)
  const identityChanged = draft && (!baseline || draft.name !== baseline.name || draft.description !== baseline.description)
  const policyChanged = draft && (draft.isNew ? CATALOG.some(item => draft.permissions?.[item.id] === true) : JSON.stringify(draft.permissions) !== JSON.stringify(baseline?.permissions))
  const canSaveDraft = Boolean(draft && (draft.isNew ? can('settings.roles.create') : !identityChanged || can('settings.roles.edit')) && (!policyChanged || can('settings.roles.permissions')))
  const openPreview = () => setPreview({ role: clone({ ...displayed, permissions }), dirty })

  useEffect(() => {
    if (!dirty) return undefined
    const preventUnload = event => { event.preventDefault(); event.returnValue = '' }
    const preventNavigation = event => {
      event.preventDefault()
      if (saving) { event.detail?.onBlocked?.(); return }
      ask('Cambios sin guardar', '¿Querés descartar los cambios de este rol y continuar?', () => {
        setDraft(null); setBaseline(null); event.detail?.proceed?.()
      })
    }
    window.addEventListener('beforeunload', preventUnload)
    window.addEventListener('pignus:before-navigate', preventNavigation)
    return () => { window.removeEventListener('beforeunload', preventUnload); window.removeEventListener('pignus:before-navigate', preventNavigation) }
  }, [dirty, saving, ask])

  const edit = changes => {
    if (!draft) setBaseline(clone(roleBaseline?.(selected.id) || selected))
    setDraft(previous => ({ ...(previous || selected), permissions: previous?.permissions || (can('settings.roles.permissions') ? permissions : selected.permissions), ...changes }))
    setError('')
  }
  const selectRole = id => {
    const change = () => { setActive(id); setDraft(null); setBaseline(null); setError(''); setImpact('') }
    if (dirty) ask('Cambios sin guardar', '¿Querés descartar los cambios antes de seleccionar otro rol?', change)
    else change()
  }
  const create = () => {
    const start = () => {
      const id = Date.now()
      const initial = blankPermissions()
      for (const [prefix] of scopeFields) {
        const own = actorScope(prefix)
        if (own !== 'all') initial[`${prefix}.${own}`] = true
      }
      setDraft({ id, code: `role-${id}`, name: '', description: '', permissions: initial, isNew: true })
      setBaseline(null); setError(''); setImpact('')
    }
    if (dirty) ask('Cambios sin guardar', '¿Querés descartar los cambios antes de crear otro rol?', start)
    else start()
  }
  const toggle = key => {
    if (!canChangePermissions || saving || (!permissions[key] && !can(key))) return
    const next = togglePermission({ ...displayed, permissions }, key, !permissions[key])
    if (next.reason) { setError(next.reason); return }
    edit({ permissions: next.permissions })
    setImpact(next.removed.length ? `También se desactivaron: ${next.removed.map(id => BY_ID[id].label).join('; ')}.` : 'Los cambios se aplicarán al guardar el rol.')
  }
  const scope = prefix => prefix === 'scope.services.read' ? readScope({ permissions }) : prefix === 'scope.services.write' ? writeScope({ permissions }) : readScope({ permissions }, 'customers')
  const actorScope = prefix => prefix === 'scope.services.read' ? readScope(user) : prefix === 'scope.services.write' ? writeScope(user) : readScope(user, 'customers')
  const changeScope = (prefix, value) => {
    if (!canChangePermissions || saving || (actorScope(prefix) !== 'all' && actorScope(prefix) !== value)) return
    const next = { ...permissions }
    for (const option of ['assigned', 'related', 'cctv']) delete next[`${prefix}.${option}`]
    if (value !== 'all') next[`${prefix}.${value}`] = true
    edit({ permissions: next })
  }
  const save = async event => {
    event.preventDefault()
    if (!draft || saving) return
    if (!canSaveDraft) { setError('Tu rol actual no permite guardar estos cambios. Podés conservar el borrador o descartarlo.'); return }
    const name = String(draft.name || '').trim()
    if (!name) { setError('Ingresá un nombre para el rol.'); return }
    if (roles.some(role => String(role.id) !== String(draft.id) && role.name.trim().toLocaleLowerCase('es') === name.toLocaleLowerCase('es'))) { setError('Ya existe un rol con ese nombre.'); return }
    const { isNew, ...after } = { ...draft, name, permissions: isGranular(draft) ? toGranularPermissions(draft) : draft.permissions }
    const permissionChange = !baseline || JSON.stringify(baseline.permissions) !== JSON.stringify(after.permissions)
    if (permissionChange && !canDelegateRole(user, { ...after, assignable: undefined })) { setError('Este rol tiene permisos o alcances que no podés delegar. Quitalos antes de guardar o solicitá la intervención de un administrador.'); return }
    setSaving(true); setError('')
    try {
      if (persistRole) await persistRole(baseline, after)
      else setRoles(previous => isNew ? [...previous, after] : previous.map(role => String(role.id) === String(after.id) ? after : role))
      setActive(after.id); setDraft(null); setBaseline(null); setImpact('')
      setNotice('El rol y sus permisos se guardaron correctamente.')
    } catch (saveError) { setError(saveError.message || 'No se pudo guardar el rol. Se conservaron los cambios para revisar.') }
    finally { setSaving(false) }
  }
  return <>
    {canConfigureWorkday && <WorkdaySettings {...{ weekly, persistWeeklyConfiguration, setNotice }} canManage={can('settings.workday.manage')} />}
    {can('settings.roles.read') && <div className="role-permissions">
      <div className="module-intro">
        <ModuleIntroduction><h1>Roles y permisos</h1><p>Definí qué puede consultar y hacer cada rol. Las opciones en gris indican qué requisito falta.</p></ModuleIntroduction>
        {can('settings.roles.create') && <button type="button" className="primary" disabled={saving} onClick={create} title="Creá un rol sin permisos iniciales."><Icon name="plus" />Nuevo rol</button>}
      </div>
      <div className="role-permission-layout">
        <aside className="data-card role-picker" aria-label="Roles disponibles"><h2>Roles disponibles</h2>
          {roles.map(role => <button type="button" className={String(role.id) === String(displayed?.id) ? 'role-choice selected' : 'role-choice'} key={role.id} disabled={saving} aria-pressed={String(role.id) === String(displayed?.id)} onClick={() => selectRole(role.id)} title={`Revisá los permisos del rol ${role.name}.`}><b>{role.name}</b><small>{role.description}</small></button>)}
        </aside>
        {displayed && <form className="data-card role-permission-editor" onSubmit={save} aria-busy={saving}>
          <div className="role-fields">
            <label>Nombre del rol<input required maxLength={80} value={displayed.name || ''} disabled={saving || !canChangeIdentity} onChange={event => edit({ name: event.target.value })} /></label>
            <label>Descripción<input maxLength={500} value={displayed.description || ''} disabled={saving || !canChangeIdentity} onChange={event => edit({ description: event.target.value })} /></label>
          </div>
          {protectedRole && <p className="role-permission-hint">Administrador conserva acceso completo para garantizar la administración del sistema.</p>}
          <div className="role-preview-launch"><button type="button" className="secondary" disabled={saving} onClick={openPreview} title="Explorá los accesos de este rol con los cambios actuales, sin guardarlos."><Icon name="eye" />Vista previa del rol</button></div>
          <details className="role-scopes"><summary>Alcance de consultas y acciones</summary><div className="role-fields">
            {scopeFields.map(([prefix, label, options]) => <label key={prefix}>{label}<select aria-label={label} value={scope(prefix)} disabled={saving || !canChangePermissions} onChange={event => changeScope(prefix, event.target.value)}>{scope(prefix) === 'none' && <option value="none">{scopeLabels.none}</option>}{options.map(value => <option key={value} value={value} disabled={actorScope(prefix) !== 'all' && actorScope(prefix) !== value}>{scopeLabels[value]}</option>)}</select></label>)}
          </div><p className="role-permission-hint">Las acciones sólo alcanzan registros que también se pueden consultar. Los servicios técnicos siguen requiriendo asignación y habilitación del colaborador.</p></details>
          <label className="role-module-picker">Módulo<select value={module} onChange={event => setModule(event.target.value)}>{PERMISSION_GROUPS.map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select></label>
          {module === 'notifications' && <p className="role-permission-hint">Elegí qué avisos recibe este rol en la campana. Cada categoría requiere acceso a sus datos; recibir un aviso no habilita acciones adicionales. Administrador conserva todos los avisos, incluidas las solicitudes de adelanto.</p>}
          <p className="role-permission-hint">{items.filter(item => permissions[item.id]).length} de {items.length} permisos habilitados</p>
          <div className="role-capabilities">{items.map(item => {
            const reason = dependencyReason(item.id, permissions)
            const delegationBlocked = !permissions[item.id] && !can(item.id)
            const disabled = saving || !canChangePermissions || Boolean(reason) || delegationBlocked
            return <div className={`role-capability ${disabled ? 'unavailable' : ''}`} key={item.id}>
              <label><input type="checkbox" checked={permissions[item.id] === true} disabled={disabled} onChange={() => toggle(item.id)} aria-describedby={`role-permission-${item.id}`} /><span>{item.label}{item.sensitive && <small className="sensitive-permission">Acceso sensible</small>}</span></label>
              <div id={`role-permission-${item.id}`} className="role-permission-detail">
                {reason && <p>{reason}</p>}
                {!reason && delegationBlocked && <p>No podés conceder un permiso que tu rol no tiene.</p>}
                {item.note && <small>{item.note}</small>}
                {item.groups.some(id => id !== module && PERMISSION_GROUPS.some(row => row[0] === id)) && <small>Compartido con {item.groups.filter(id => id !== module).map(id => PERMISSION_GROUPS.find(row => row[0] === id)?.[1]).filter(Boolean).join(', ')}.</small>}
              </div>
            </div>
          })}</div>
          {impact && <p className="role-permission-hint" role="status">{impact}</p>}
          {dirty && !canSaveDraft && <p className="role-permission-hint" role="status">Tu rol actual no permite guardar estos cambios. El borrador se conserva.</p>}
          {error && <p className="field-error" role="alert">{error}</p>}
          <div className="modal-actions role-save-actions">
            <button type="submit" className="primary" disabled={saving || !canSaveDraft} title="Guardá juntos los permisos, alcances y datos del rol.">{saving ? 'Guardando…' : 'Guardar rol'}</button>
            <button type="button" className="secondary" disabled={saving} onClick={openPreview} title="Revisá cómo quedan los permisos y los avisos antes de guardar."><Icon name="eye" />Vista previa del rol</button>
            {dirty && <button type="button" className="secondary" disabled={saving} onClick={() => { setDraft(null); setBaseline(null); setError(''); setImpact('') }} title="Descartá los cambios que todavía no guardaste.">Descartar cambios</button>}
          </div>
        </form>}
      </div>
      {preview && <RolePreview role={preview.role} dirty={preview.dirty} onClose={() => setPreview(null)} />}
    </div>}
  </>
}

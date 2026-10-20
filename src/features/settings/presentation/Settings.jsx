import React from 'react'
import { useState, useRef, useEffect } from "react";
import { normalizeRoleName, roleCode, resolvedRolePermissions, DEFAULT_MODULE_PERMISSIONS, DEFAULT_FEATURE_PERMISSIONS, MODULE_PERMISSIONS, FEATURE_PERMISSIONS } from "../../../domain/access/permissions.mjs";
import WorkdaySettings from "../../../components/WorkdaySettings.jsx";
import ModuleIntroduction from "../../../components/ModuleIntroduction.jsx";
import Icon from "../../../components/ui/Icon.jsx";
import RequiredLabel from "../../../presentation/components/forms/RequiredLabel.jsx";

export default function Settings({ roles, setRoles, setNotice, ask, weekly, persistWeeklyConfiguration, canConfigureWorkday = false }) {
  const [active, setActive] = useState(roles[0]?.id); const [editing, setEditing] = useState(false); const [name, setName] = useState(''); const [description, setDescription] = useState(''); const role = roles.find(x => x.id === active) || roles[0]
  const roleNameRef = useRef(null)
  const [nameError, setNameError] = useState('')
  useEffect(() => { if (editing) { roleNameRef.current?.focus(); roleNameRef.current?.scrollIntoView({ block: 'center', behavior: 'auto' }) } }, [editing])
  const startEdit = r => { setActive(r.id); setNameError(''); setName(r.name); setDescription(r.description); setEditing(true) }
  const save = event => {
    event.preventDefault()
    const roleName = name.trim()
    if (!roleName) { setNameError('Ingresá un nombre para el rol.'); roleNameRef.current?.focus(); return }
    setNameError('')
    const nextId = editing === 'new' ? Date.now() : role.id
    const supervisorRole = normalizeRoleName(roleName) === 'supervisor'
    const operatorRole = normalizeRoleName(roleName) === 'operador' || roleCode(role) === 'operator' && editing !== 'new'
    const next = {
      id: nextId,
      code: operatorRole ? 'operator' : supervisorRole ? 'supervisor' : editing === 'new' ? `role-${nextId}` : roleCode(role),
      name: roleName,
      description,
      permissions: operatorRole ? resolvedRolePermissions({ name: 'Operador' }) : supervisorRole ? resolvedRolePermissions({ name: 'Supervisor' }) : editing === 'new' ? { ...DEFAULT_MODULE_PERMISSIONS, ...DEFAULT_FEATURE_PERMISSIONS, dashboard: true, agenda: true } : resolvedRolePermissions(role)
    }
    ask(editing === 'new' ? 'Crear rol' : 'Guardar permisos', `¿Querés confirmar los cambios del rol ${roleName}?`, () => { setRoles(prev => editing === 'new' ? [...prev, next] : prev.map(x => x.id === role.id ? next : x)); setActive(next.id); setEditing(false); setNotice('La configuración del rol fue guardada.') })
  }
  const toggle = key => {
    const current = resolvedRolePermissions(role)
    const enabled = Boolean(current[key])
    ask('Modificar permiso', `¿Querés ${enabled ? 'revocar' : 'otorgar'} “${[...MODULE_PERMISSIONS.map(item => [item[0], item[1]]), ...FEATURE_PERMISSIONS.map(item => [item[1], item[2]])].find(item => item[0] === key)?.[1] || key}” al rol ${role.name}?`, () => setRoles(previous => previous.map(item => {
      if (item.id !== role.id) return item
      const permissions = { ...resolvedRolePermissions(item), [key]: !enabled }
      if (enabled) FEATURE_PERMISSIONS.filter(([moduleKey]) => moduleKey === key).forEach(([, featureKey]) => { permissions[featureKey] = false })
      return { ...item, permissions }
    })))
  }
  return <>{canConfigureWorkday && <WorkdaySettings {...{ weekly, persistWeeklyConfiguration, setNotice }} />}<div className="module-intro"><ModuleIntroduction><p className="eyebrow">ADMINISTRACIÓN</p><h1>Roles y permisos</h1><p>Habilitá módulos completos y definí qué acciones puede realizar cada rol dentro de ellos.</p></ModuleIntroduction><button title="Creá un rol y definí sus permisos de acceso." className="primary" onClick={() => { setName(''); setDescription(''); setNameError(''); setEditing('new') }}><Icon name="plus" />Nuevo rol</button></div><div className="settings-grid"><article className="data-card roles-card"><h2>Roles disponibles</h2>{roles.map(r => <div className={r.id === role?.id ? 'selected-role' : ''} key={r.id} onClick={() => setActive(r.id)}><span className="role-dot">{r.name[0]}</span><div><b>{r.name}</b><p>{r.description}</p></div><button onClick={e => { e.stopPropagation(); startEdit(r) }} title="Modificá el nombre, la descripción y los permisos del rol."><Icon name="edit" size={16} /></button></div>)}</article><article className="data-card permissions-card">{editing ? <form className="role-editor" onSubmit={save}><p className="eyebrow">{editing === 'new' ? 'NUEVO ROL' : 'EDITAR ROL'}</p><label><RequiredLabel>Nombre del rol</RequiredLabel><input ref={roleNameRef} required maxLength="80" value={name} aria-invalid={Boolean(nameError)} aria-describedby={nameError ? "role-name-error" : undefined} onChange={e => { setName(e.target.value); setNameError('') }} /></label>{nameError && <p id="role-name-error" className="field-error" role="alert">{nameError}</p>}<label>Descripción<input value={description} onChange={e => setDescription(e.target.value)} /></label><button title="Guardá la configuración y los permisos de este rol." className="primary" type="submit"><Icon name="check" />Guardar rol</button><button title="Cancelá esta operación sin aplicar los cambios del formulario." className="secondary" type="button" onClick={() => setEditing(false)}><Icon name="close" size={16} />Cancelar</button></form> : <><p className="eyebrow">PERFIL: {role?.name?.toUpperCase()}</p><h2>Permisos por módulo y función</h2>{MODULE_PERMISSIONS.map(([key, label, detail]) => { const adminRole = roleCode(role) === 'administrator'; const operatorRole = roleCode(role) === 'operator'; const supervisorRole = roleCode(role) === 'supervisor' || operatorRole; const auditOnly = key === 'audit'; const locked = auditOnly || adminRole || supervisorRole; const moduleEnabled = adminRole || Boolean(resolvedRolePermissions(role)[key]); const features = FEATURE_PERMISSIONS.filter(([moduleKey]) => moduleKey === key); const permissionDetail = operatorRole ? key === 'weekly' ? 'Consulta de solo lectura, sin crear, editar ni eliminar servicios' : 'No disponible para el rol Operador' : supervisorRole ? key === 'history' ? 'Consulta de solo lectura limitada a cuentas con Servicio de CCTV' : 'No disponible para el rol Supervisor' : auditOnly ? 'Exclusivo del rol Administrador' : detail; return <section className="permission-group" key={key}><label className={`permission ${locked ? 'locked-permission' : ''}`}><span><b>{label}</b><small>{permissionDetail}</small></span><input type="checkbox" checked={moduleEnabled} disabled={locked} onChange={() => toggle(key)} /><i /></label>{features.length > 0 && <div className="feature-permissions">{features.map(([, featureKey, featureLabel, featureDetail]) => <label className={`permission feature-permission ${!moduleEnabled || adminRole || supervisorRole ? 'locked-permission' : ''}`} key={featureKey}><span><b>{featureLabel}</b><small>{supervisorRole ? 'No disponible para el rol Supervisor' : featureDetail}</small></span><input type="checkbox" checked={adminRole || Boolean(resolvedRolePermissions(role)[featureKey])} disabled={!moduleEnabled || adminRole || supervisorRole} onChange={() => toggle(featureKey)} /><i /></label>)}</div>}</section> })}<button title="Modificá el nombre, la descripción y los permisos del rol." className="primary save" onClick={() => startEdit(role)}><Icon name="edit" />Editar rol</button></>}</article></div></>
}

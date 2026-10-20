import { useActionPermissions } from '../../../presentation/hooks/useActionPermissions.mjs'
import { canDelegateRole, canManageEmployeeAccount } from '../../../domain/access/role-delegation.mjs'
import React from 'react'
import { sortEmployeesAlphabetically } from "../../../domain/shared/catalog-order.mjs";
import { useState, useRef } from "react";
import { roleCode } from "../../../domain/access/permissions.mjs";
import ModuleIntroduction from "../../../components/ModuleIntroduction.jsx";
import Icon from "../../../components/ui/Icon.jsx";
import EditorModal from "../../../components/ui/EditorModal.jsx";
import RequiredLabel from "../../../presentation/components/forms/RequiredLabel.jsx";
import { initials } from '../../../presentation/formatting.mjs'

export default function Employees({ employees, setEmployees, roles, setNotice, ask, history, teams, weekly, persistEmployee, employeeBaseline, canEnableTechnical = false }) {
  const { can, granular, user } = useActionPermissions()
  const canEdit = ['employees.edit', 'employees.role', 'employees.password', 'employees.technical'].some(key => can(key, key !== 'employees.technical' || canEnableTechnical))
  const assignableRoles = roles.filter(role => canDelegateRole(user, role))
  const manageable = employee => canManageEmployeeAccount(user, employee, roles)
  employees = sortEmployeesAlphabetically(employees)
  const [form, setForm] = useState(blankEmployee); const [editing, setEditing] = useState(null); const [open, setOpen] = useState(false)
  const [baseline, setBaseline] = useState(null)
  const [saving, setSaving] = useState(false)
  const saveGuard = useRef(false)
  const save = event => {
    event.preventDefault()
    if (saveGuard.current || (editing ? !canEdit : !can('employees.create'))) return
    const assignedRole = roles.find(role => String(role.id) === String(form.roleId))
    if (granular && (!editing || String(form.roleId) !== String(baseline?.roleId)) && !canDelegateRole(user, assignedRole)) { setNotice('No podés asignar ese rol.'); return }
    if (!assignedRole) { setNotice('Seleccioná un rol válido.'); return }
    const record = { ...form, firstName: form.firstName.trim(), lastName: form.lastName.trim(), name: `${form.firstName.trim()} ${form.lastName.trim()}`, roleId: assignedRole.id, role: assignedRole.name, id: editing || crypto.randomUUID(), technicalEnabled: !granular && ['operator', 'supervisor'].includes(roleCode(assignedRole)) ? false : form.technicalEnabled === true }
    if (granular && editing && baseline) {
      for (const [permission, fields] of [
        ['employees.edit', ['firstName', 'lastName', 'name', 'phone', 'email']],
        ['employees.role', ['roleId', 'role']],
        ['employees.technical', ['technicalEnabled']]
      ]) if (!can(permission)) for (const key of fields) {
        if (Object.hasOwn(baseline, key)) record[key] = baseline[key]
        else delete record[key]
      }
      if (!can('employees.password')) delete record.password
    }
    ask(editing ? 'Confirmar edición' : 'Confirmar alta', `¿Querés guardar el perfil de ${record.name}?`, async () => {
      if (saveGuard.current || (editing ? !canEdit : !can('employees.create'))) return
      saveGuard.current = true
      setSaving(true)
      try {
        await persistEmployee(baseline, record)
        setOpen(false); setEditing(null); setForm(blankEmployee); setBaseline(null)
        setNotice('El colaborador fue guardado correctamente.')
      } finally { saveGuard.current = false; setSaving(false) }
    })
  }
  const removeEmployee = employee => {
    if (!can('employees.delete') || !manageable(employee)) return
    const agendaTeams = [...(teams || []), ...Object.entries(weekly || {}).flatMap(([key, value]) => key === '_monthlyTeams' ? Object.values(value || {}).flatMap(config => config?.teams || []) : key.startsWith('_') ? [] : value?.teams || [])]
    const referenced = history.some(record => (record.technicianIds || []).some(id => String(id) === String(employee.id))) || agendaTeams.some(team => (team.memberIds || []).some(id => String(id) === String(employee.id)))
    if (referenced && !can('employees.status')) { setNotice('El colaborador tiene asignaciones vinculadas. Necesitás permiso para desactivarlo.'); return }
    if (referenced) { setEmployees(previous => previous.map(item => item.id === employee.id ? { ...item, status: 'Inactivo' } : item)); setNotice('El colaborador tiene asignaciones vinculadas: se marcó como inactivo en lugar de eliminarlo.'); return }
    setEmployees(previous => previous.filter(item => item.id !== employee.id)); setNotice('El colaborador fue eliminado.')
  }
  return <><div className="module-intro"><ModuleIntroduction><p className="eyebrow">EQUIPO PIGNUS</p><h1>Colaboradores</h1><p>Administrá accesos, datos de contacto y disponibilidad del equipo.</p></ModuleIntroduction>{can('employees.create') && <button title="Abrí el formulario para registrar un colaborador y configurar su perfil." className="primary" disabled={granular && !assignableRoles.length} onClick={() => { const initialRole = assignableRoles[0]; setForm(granular && initialRole ? { ...blankEmployee, roleId: initialRole.id, role: initialRole.name } : blankEmployee); setBaseline(null); setEditing(null); setOpen(true) }}><Icon name="plus" />Nuevo colaborador</button>}</div>{open && <EmployeeForm {...{ form, setForm, roles, save, cancel: () => setOpen(false), editing, canEnableTechnical, saving }} />}<div className="data-card employees-table"><div className="table-head">{['Colaborador', 'Rol', 'Correo', 'Contacto', 'Estado', 'Acciones'].map(x => <span key={x}>{x}</span>)}</div>{employees.map(x => <div className="employee-row" key={x.id}><div className="person"><span>{initials(x.name)}</span><b>{x.name}</b></div><div><em className="role-chip">{roles.find(role => String(role.id) === String(x.roleId))?.name || x.role}</em>{x.technicalEnabled === true && <small>También realiza servicios técnicos</small>}</div><div>{x.email}</div><div>{x.phone || 'Sin teléfono'}</div><div><button title={x.status === 'Activo' ? 'Marcá al colaborador como inactivo para dejar de usar su perfil activo.' : 'Marcá al colaborador como activo para habilitar su perfil.'} disabled={!can('employees.status') || !manageable(x)} className={`status ${x.status === 'Activo' ? 'on' : ''}`} onClick={() => ask('Cambiar estado', `¿Querés marcar a ${x.name} como ${x.status === 'Activo' ? 'inactivo' : 'activo'}?`, () => setEmployees(prev => prev.map(y => y.id === x.id ? { ...y, status: y.status === 'Activo' ? 'Inactivo' : 'Activo' } : y)))}>{x.status}</button></div><div className="row-actions">{canEdit && manageable(x) && <button title="Modificá los datos, el rol y la configuración del colaborador." onClick={() => { setForm({ ...x, password: ''}); setBaseline(employeeBaseline(x.id)); setEditing(x.id); setOpen(true) }}><Icon name="edit" size={16} /></button>}{can('employees.delete') && manageable(x) && <button className="delete" title="Solicitá eliminar el perfil de este colaborador." onClick={() => ask('Eliminar colaborador', `¿Querés eliminar el perfil de ${x.name}?`, () => removeEmployee(x), true)}><Icon name="trash" size={16} /></button>}</div></div>)}</div></>
}

function EmployeeForm({ form, setForm, roles, save, cancel, editing, canEnableTechnical = false, saving = false }) {
  const { can, granular, user } = useActionPermissions()
  const canEditContact = !editing || can('employees.edit')
  const availableRoles = roles.filter(role => canDelegateRole(user, role) || String(role.id) === String(form.roleId))
  const initialForm = useRef(JSON.stringify(form))
  const set = key => event => setForm({ ...form, [key]: event.target.value })
  const restrictedRole = !granular && ['operator', 'supervisor'].includes(roleCode(roles.find(role => String(role.id) === String(form.roleId))))
  return <EditorModal active title={editing ? "Editar colaborador" : "Nuevo colaborador"} eyebrow={editing ? 'EDITAR REGISTRO' : 'ALTA DE COLABORADOR'} onClose={cancel} busy={saving} dirty={JSON.stringify(form) !== initialForm.current}>
    {({ requestClose }) => <form className="employee-form employee-form-wide" onSubmit={save} aria-busy={saving}>
      <label><RequiredLabel>Nombre</RequiredLabel><input required autoComplete="given-name" disabled={!canEditContact} value={form.firstName || ''} onChange={set('firstName')} /></label>
      <label><RequiredLabel>Apellido</RequiredLabel><input required autoComplete="family-name" disabled={!canEditContact} value={form.lastName || ''} onChange={set('lastName')} /></label>
      <label>Teléfono<input type="tel" autoComplete="tel" disabled={!canEditContact} value={form.phone || ''} onChange={set('phone')} /></label>
      <label><RequiredLabel>Correo electrónico</RequiredLabel><input required type="email" autoComplete="email" disabled={!canEditContact} value={form.email || ''} onChange={set('email')} /></label>
      <label><RequiredLabel>Rol</RequiredLabel><select disabled={Boolean(editing) && !can('employees.role')} required value={form.roleId ?? roles.find(role => role.name === form.role)?.id ?? ''} onChange={event => { const selectedRole = roles.find(role => String(role.id) === event.target.value); setForm({ ...form, roleId: selectedRole?.id, role: selectedRole?.name || '' }) }}>{availableRoles.map(role => <option key={role.id} value={role.id}>{role.name}</option>)}</select></label>
      <label>{editing ? 'Contraseña' : <RequiredLabel>Contraseña</RequiredLabel>}<input disabled={Boolean(editing) && !can('employees.password')} required={!editing} minLength="8" pattern="(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9]).{8,}" title="Usá al menos 8 caracteres, una mayúscula, una minúscula y un número." autoComplete="new-password" type="password" value={form.password || ''} placeholder={editing ? 'Dejar vacío para conservarla' : '8 caracteres, mayúscula, minúscula y número'} onChange={set('password')} /></label>
      <div className="employee-technical-option">
        <label className="employee-technical-toggle">
          <input type="checkbox" checked={!restrictedRole && form.technicalEnabled === true} disabled={saving || !can('employees.technical', canEnableTechnical) || restrictedRole} aria-describedby="employee-technical-help" onChange={event => setForm({ ...form, technicalEnabled: event.target.checked })} />
          <span>Puede realizar servicios técnicos</span>
        </label>
        <p id="employee-technical-help">{restrictedRole ? 'Este rol es de solo lectura y no admite servicios técnicos.' : granular ? 'La habilitación requiere el permiso correspondiente y no reemplaza los permisos de ejecución.' : 'Conserva su rol y agrega el acceso a Mis servicios. Solo Administración puede cambiar esta habilitación.'}</p>
      </div>
      <div className="employee-form-actions">
        <button title="Guardá los datos y la configuración del colaborador." className="primary" disabled={saving}><Icon name="check" />{saving ? 'Guardando…' : editing ? 'Guardar cambios' : 'Guardar colaborador'}</button>
        <button title="Cancelá esta operación sin aplicar los cambios del formulario." type="button" className="secondary" disabled={saving} onClick={requestClose}><Icon name="close" size={16} />Cancelar</button>
      </div>
    </form>}
  </EditorModal>
}

const blankEmployee = { firstName: '', lastName: '', name: '', roleId: 3, role: 'Técnico', phone: '', email: '', password: '', status: 'Activo' }

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
  employees = sortEmployeesAlphabetically(employees)
  const [form, setForm] = useState(blankEmployee); const [editing, setEditing] = useState(null); const [open, setOpen] = useState(false)
  const [baseline, setBaseline] = useState(null)
  const [saving, setSaving] = useState(false)
  const saveGuard = useRef(false)
  const save = event => {
    event.preventDefault()
    if (saveGuard.current) return
    const assignedRole = roles.find(role => String(role.id) === String(form.roleId))
    if (!assignedRole) { setNotice('Seleccioná un rol válido.'); return }
    const record = { ...form, firstName: form.firstName.trim(), lastName: form.lastName.trim(), name: `${form.firstName.trim()} ${form.lastName.trim()}`, roleId: assignedRole.id, role: assignedRole.name, id: editing || crypto.randomUUID(), technicalEnabled: ['operator', 'supervisor'].includes(roleCode(assignedRole)) ? false : form.technicalEnabled === true }
    ask(editing ? 'Confirmar edición' : 'Confirmar alta', `¿Querés guardar el perfil de ${record.name}?`, async () => {
      if (saveGuard.current) return
      saveGuard.current = true
      setSaving(true)
      try {
        await persistEmployee(baseline, record)
        setOpen(false); setEditing(null); setForm(blankEmployee); setBaseline(null)
        setNotice('El empleado fue guardado correctamente.')
      } finally { saveGuard.current = false; setSaving(false) }
    })
  }
  const removeEmployee = employee => {
    const agendaTeams = [...(teams || []), ...Object.entries(weekly || {}).flatMap(([key, value]) => key === '_monthlyTeams' ? Object.values(value || {}).flatMap(config => config?.teams || []) : key.startsWith('_') ? [] : value?.teams || [])]
    const referenced = history.some(record => (record.technicianIds || []).some(id => String(id) === String(employee.id))) || agendaTeams.some(team => (team.memberIds || []).some(id => String(id) === String(employee.id)))
    if (referenced) { setEmployees(previous => previous.map(item => item.id === employee.id ? { ...item, status: 'Inactivo' } : item)); setNotice('El empleado tiene asignaciones vinculadas: se marcó como inactivo en lugar de eliminarlo.'); return }
    setEmployees(previous => previous.filter(item => item.id !== employee.id)); setNotice('El empleado fue eliminado.')
  }
  return <><div className="module-intro"><ModuleIntroduction><p className="eyebrow">EQUIPO PIGNUS</p><h1>Técnicos y colaboradores</h1><p>Administrá accesos, datos de contacto y disponibilidad del equipo.</p></ModuleIntroduction><button title="Abrí el formulario para registrar un empleado y configurar su perfil." className="primary" onClick={() => { setForm(blankEmployee); setBaseline(null); setEditing(null); setOpen(true) }}><Icon name="plus" />Nuevo empleado</button></div>{open && <EmployeeForm {...{ form, setForm, roles, save, cancel: () => setOpen(false), editing, canEnableTechnical, saving }} />}<div className="data-card employees-table"><div className="table-head">{['Empleado', 'Rol', 'Correo', 'Contacto', 'Estado', 'Acciones'].map(x => <span key={x}>{x}</span>)}</div>{employees.map(x => <div className="employee-row" key={x.id}><div className="person"><span>{initials(x.name)}</span><b>{x.name}</b></div><div><em className="role-chip">{roles.find(role => String(role.id) === String(x.roleId))?.name || x.role}</em>{x.technicalEnabled === true && <small>También realiza servicios técnicos</small>}</div><div>{x.email}</div><div>{x.phone || 'Sin teléfono'}</div><div><button title={x.status === 'Activo' ? 'Marcá al empleado como inactivo para dejar de usar su perfil activo.' : 'Marcá al empleado como activo para habilitar su perfil.'} className={`status ${x.status === 'Activo' ? 'on' : ''}`} onClick={() => ask('Cambiar estado', `¿Querés marcar a ${x.name} como ${x.status === 'Activo' ? 'inactivo' : 'activo'}?`, () => setEmployees(prev => prev.map(y => y.id === x.id ? { ...y, status: y.status === 'Activo' ? 'Inactivo' : 'Activo' } : y)))}>{x.status}</button></div><div className="row-actions"><button title="Modificá los datos, el rol y la configuración del empleado." onClick={() => { setForm({ ...x, password: ''}); setBaseline(employeeBaseline(x.id)); setEditing(x.id); setOpen(true) }}><Icon name="edit" size={16} /></button><button className="delete" title="Solicitá eliminar el perfil de este empleado." onClick={() => ask('Eliminar empleado', `¿Querés eliminar el perfil de ${x.name}?`, () => removeEmployee(x), true)}><Icon name="trash" size={16} /></button></div></div>)}</div></>
}

function EmployeeForm({ form, setForm, roles, save, cancel, editing, canEnableTechnical = false, saving = false }) {
  const initialForm = useRef(JSON.stringify(form))
  const set = key => event => setForm({ ...form, [key]: event.target.value })
  const restrictedRole = ['operator', 'supervisor'].includes(roleCode(roles.find(role => String(role.id) === String(form.roleId))))
  return <EditorModal active title={editing ? "Editar empleado" : "Nuevo empleado"} eyebrow={editing ? 'EDITAR REGISTRO' : 'ALTA DE EMPLEADO'} onClose={cancel} busy={saving} dirty={JSON.stringify(form) !== initialForm.current}>
    {({ requestClose }) => <form className="employee-form employee-form-wide" onSubmit={save} aria-busy={saving}>
      <label><RequiredLabel>Nombre</RequiredLabel><input required autoComplete="given-name" value={form.firstName || ''} onChange={set('firstName')} /></label>
      <label><RequiredLabel>Apellido</RequiredLabel><input required autoComplete="family-name" value={form.lastName || ''} onChange={set('lastName')} /></label>
      <label>Teléfono<input type="tel" autoComplete="tel" value={form.phone || ''} onChange={set('phone')} /></label>
      <label><RequiredLabel>Correo electrónico</RequiredLabel><input required type="email" autoComplete="email" value={form.email || ''} onChange={set('email')} /></label>
      <label><RequiredLabel>Rol</RequiredLabel><select required value={form.roleId ?? roles.find(role => role.name === form.role)?.id ?? ''} onChange={event => { const selectedRole = roles.find(role => String(role.id) === event.target.value); setForm({ ...form, roleId: selectedRole?.id, role: selectedRole?.name || '' }) }}>{roles.map(role => <option key={role.id} value={role.id}>{role.name}</option>)}</select></label>
      <label>{editing ? 'Contraseña' : <RequiredLabel>Contraseña</RequiredLabel>}<input required={!editing} minLength="8" pattern="(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9]).{8,}" title="Usá al menos 8 caracteres, una mayúscula, una minúscula y un número." autoComplete="new-password" type="password" value={form.password || ''} placeholder={editing ? 'Dejar vacío para conservarla' : '8 caracteres, mayúscula, minúscula y número'} onChange={set('password')} /></label>
      <div className="employee-technical-option">
        <label className="employee-technical-toggle">
          <input type="checkbox" checked={!restrictedRole && form.technicalEnabled === true} disabled={saving || !canEnableTechnical || restrictedRole} aria-describedby="employee-technical-help" onChange={event => setForm({ ...form, technicalEnabled: event.target.checked })} />
          <span>Puede realizar servicios técnicos</span>
        </label>
        <p id="employee-technical-help">{restrictedRole ? 'Este rol es de solo lectura y no admite servicios técnicos.' : 'Conserva su rol y agrega el acceso a Mis servicios. Solo Administración puede cambiar esta habilitación.'}</p>
      </div>
      <div className="employee-form-actions">
        <button title="Guardá los datos y la configuración del empleado." className="primary" disabled={saving}><Icon name="check" />{saving ? 'Guardando…' : editing ? 'Guardar cambios' : 'Guardar empleado'}</button>
        <button title="Cancelá esta operación sin aplicar los cambios del formulario." type="button" className="secondary" disabled={saving} onClick={requestClose}><Icon name="close" size={16} />Cancelar</button>
      </div>
    </form>}
  </EditorModal>
}

const blankEmployee = { firstName: '', lastName: '', name: '', roleId: 3, role: 'Técnico', phone: '', email: '', password: '', status: 'Activo' }

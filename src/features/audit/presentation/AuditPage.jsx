import { useActionPermissions } from '../../../presentation/hooks/useActionPermissions.mjs'
import React, { useState, useEffect, useMemo } from "react";
import { auditRepository } from "../../../infrastructure/repositories/audit-repository.mjs";
import Icon from "../../../components/ui/Icon.jsx";
import RefreshButton from "../../../components/ui/RefreshButton.jsx";
import ModuleIntroduction from "../../../components/ModuleIntroduction.jsx";
import { prettyReportDateTime } from "../../agenda/application/agenda-model.mjs";
import { Confirm } from "../../../presentation/components/Confirm.jsx";

export function AuditPage({ user, onBack, onOpenMenu, logout }) {
  const { can } = useActionPermissions()
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [action, setAction] = useState('')
  const [selected, setSelected] = useState(null)
  const [confirmLogout, setConfirmLogout] = useState(false)
  const loadAudit = async () => {
    if (!can('audit.view')) return
    setLoading(true)
    try {
      const data = await auditRepository.list(100)
      setRecords(Array.isArray(data.records) ? data.records : [])
      setError('')
    } catch (loadError) {
      setRecords([])
      setError(loadError?.message || 'No se pudo cargar el registro de auditoría.')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { void loadAudit() }, [])
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
  const openDetail = async record => {
    if (!can('audit.detail')) return
    try {
      const data = await auditRepository.findById(record.id)
      if (!data.record) throw new Error('No se pudo cargar el detalle de auditoría.')
      setSelected(data.record)
      setError('')
    } catch (detailError) {
      setError(detailError?.message || 'No se pudo cargar el detalle de auditoría.')
    }
  }
  const visible = useMemo(() => records.filter(record => (!action || record.action === action) && normalized([record.user?.name, record.user?.email, record.entity, record.entityId, record.action].join(' ')).includes(normalized(query))), [records, action, query])
  const actionClass = value => normalized(value).includes('elimino') ? 'audit-delete' : normalized(value).includes('creo') ? 'audit-create' : normalized(value).includes('modifico') ? 'audit-edit' : 'audit-status'
  return <main className="audit-page"><header className="audit-topbar"><button title="Abrí el menú lateral para elegir otro módulo." className="mobile-menu audit-mobile-menu" onClick={onOpenMenu}><Icon name="menu" /></button><button className="audit-brand" onClick={onBack} title="Volvé al menú principal para elegir otro módulo."><img src="/logo-pignus.png" alt="Pignus" /></button><div><b>Auditoría</b><span>Registro de actividad del sistema</span></div><div className="audit-user"><span>{user.name}</span><small>{user.email}</small></div><button title="Volvé al menú principal para elegir otro módulo." className="secondary small" onClick={onBack}><Icon name="dashboard" size={16} />Volver al menú</button><RefreshButton /><button title="Cerrá tu sesión; necesitarás tus credenciales para volver a ingresar." className="logout-button" onClick={() => setConfirmLogout(true)}><Icon name="logout" size={17} />Cerrar sesión</button></header><section className="audit-content"><ModuleIntroduction><p className="eyebrow">CONTROL Y TRAZABILIDAD</p><h1>Auditoría del sistema</h1><p>Consultá quién creó, modificó, eliminó o informó cambios, con fecha y detalle de cada acción.</p></ModuleIntroduction><div className="audit-filters audit-filters-compact"><label>Acción<select value={action} onChange={event => setAction(event.target.value)}><option value="">Todas las acciones</option>{[...new Set(records.map(record => record.action))].map(item => <option key={item} value={item}>{item}</option>)}</select></label><label className="audit-search">Buscar usuario, entidad o registro<input value={query} onChange={event => setQuery(event.target.value)} placeholder="Ej.: Leonardo, cliente o PIG-6375" /></label><span><b>{visible.length}</b> acciones registradas</span><button title="Consultá nuevamente el servidor para actualizar los registros de auditoría." className="secondary" onClick={loadAudit}><Icon name="history" />Actualizar</button></div>{error && <div className="notice audit-error">{error}</div>}<div className="audit-table"><div className="audit-table-head"><span>Fecha y hora</span><span>Usuario</span><span>Acción</span><span>Información afectada</span><span>Detalle</span></div>{loading ? <div className="empty-state">Cargando registro de auditoría…</div> : visible.map(record => <div className="audit-row" key={record.id}><span>{prettyReportDateTime(record.at)}</span><span><b>{record.user?.name || 'Usuario desconocido'}</b><small>{record.user?.email}</small></span><span><i className={actionClass(record.action)}>{record.action}</i></span><span><b>{record.entity}</b><small>{record.entityId}</small></span>{can('audit.detail') && <button title="Consultá el detalle del cambio registrado en la auditoría." className="secondary small" onClick={() => openDetail(record)}><Icon name="eye" size={16} />Ver detalle</button>}</div>)}{!loading && !visible.length && <div className="empty-state">No hay acciones que coincidan con los filtros seleccionados.</div>}</div></section>{selected && can('audit.detail') && <div className="modal-layer"><div className="modal audit-modal"><button title="Cerrá esta ventana y volvé a la pantalla anterior." className="modal-close" onClick={() => setSelected(null)}><Icon name="close" /></button><p className="eyebrow">DETALLE DE AUDITORÍA</p><h2>{selected.action} · {selected.entity}</h2><div className="audit-detail-meta"><span><b>Usuario</b>{selected.user?.name} · {selected.user?.email}</span><span><b>Fecha y hora</b>{prettyReportDateTime(selected.at)}</span><span><b>Registro</b>{selected.entityId}</span></div><div className="audit-diff"><section><h3>Antes</h3><pre>{selected.before ? JSON.stringify(selected.before, null, 2) : 'No aplica: es un registro nuevo.'}</pre></section><section><h3>Después</h3><pre>{selected.after ? JSON.stringify(selected.after, null, 2) : 'No aplica: el registro fue eliminado.'}</pre></section></div></div></div>}{confirmLogout && <Confirm title="Cerrar sesión" detail="¿Querés cerrar sesión? Tendrás que volver a ingresar con tus credenciales para acceder al sistema." action={logout} confirmLabel="Sí, cerrar sesión" close={() => setConfirmLogout(false)} />}</main>
}

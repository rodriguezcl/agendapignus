import React, { useMemo, useState } from 'react'
import { buildRolePreview } from '../../../domain/access/role-preview.mjs'
import Icon from '../../../components/ui/Icon.jsx'
import './role-preview.css'

const icons = { dashboard: 'dashboard', weekly: 'calendar', agenda: 'agenda', history: 'history', collections: 'wallet', accounts: 'accounts', map: 'map', employees: 'users', services: 'tools', vehicles: 'vehicle', technical: 'tools', settings: 'settings', audit: 'audit' }

function CapabilityList({ items, enabled }) {
  return <ul className="role-preview-capabilities">{items.map(item => <li key={item.id} data-permission-id={item.id} data-enabled={String(enabled)}>
    <Icon name={enabled ? 'check' : 'lock'} size={17} />
    <div><span>{item.label}</span>{(!enabled ? item.reason : item.note) && <small>{enabled ? item.note : item.reason}</small>}</div>
  </li>)}</ul>
}

function ModulePreview({ module, technical }) {
  const allowed = module.capabilities.filter(item => item.allowed)
  const blocked = module.capabilities.filter(item => !item.allowed)
  return <section className="role-preview-module" aria-label={`Funciones de ${module.label}`}>
    <div className="role-preview-page-heading"><span className="role-preview-module-icon"><Icon name={icons[module.id]} size={24} /></span><div><h3>{module.label}</h3><p>{module.description}</p></div></div>
    {module.id === 'technical' && <p className="role-preview-context">{technical.conditions.join(' ')}</p>}
    <h4>Funciones disponibles <span>{allowed.length}</span></h4>
    <CapabilityList items={allowed} enabled />
    {!allowed.length && <p className="role-preview-empty">Este módulo no tiene funciones disponibles para este perfil.</p>}
    {!!blocked.length && <details className="role-preview-unavailable"><summary>Funciones no disponibles ({blocked.length})</summary><CapabilityList items={blocked} enabled={false} /></details>}
  </section>
}

function NotificationsPreview({ notifications }) {
  const enabled = notifications.filter(item => item.enabled)
  const disabled = notifications.filter(item => !item.enabled)
  return <section className="role-preview-notifications" aria-label="Notificaciones del rol">
    <div className="role-preview-page-heading"><span className="role-preview-module-icon"><Icon name="bell" size={24} /></span><div><h3>Notificaciones del rol</h3><p>Ejemplos de los avisos habilitados. Aparecen cuando hay un pendiente dentro del alcance del rol.</p></div></div>
    {enabled.length ? <ul className="role-preview-notice-list">{enabled.map(item => <li key={item.id} data-permission-id={item.id} data-enabled="true"><Icon name="check" size={18} /><div><b>{item.title}</b><small>{item.note || item.label}</small><span className="role-preview-example">Ejemplo de aviso</span></div></li>)}</ul>
      : <p className="role-preview-empty">Este rol no recibe avisos con la configuración actual.</p>}
    {!!disabled.length && <details className="role-preview-unavailable"><summary>Avisos que no recibe ({disabled.length})</summary><CapabilityList items={disabled} enabled={false} /></details>}
  </section>
}

// An isolated, local projection of the draft. It never replaces the session or
// mounts operational modules, and receives no application data or save handlers.
export default function RolePreview({ role, dirty, onClose }) {
  const [technicalEnabled, setTechnicalEnabled] = useState(false)
  const preview = useMemo(() => buildRolePreview(role, { technicalEnabled }), [role, technicalEnabled])
  const menu = preview.navigation.filter(item => item.id !== 'help').map(item => ({ ...item, id: item.id === 'myServices' ? 'technical' : item.id }))
  const [selected, setSelected] = useState(() => preview.visibleModules[0]?.id || 'notifications')
  const current = preview.visibleModules.find(item => item.id === selected)
  const section = selected === 'notifications' ? 'notifications' : current?.id || preview.visibleModules[0]?.id || 'notifications'
  const module = preview.visibleModules.find(item => item.id === section)
  return <div className="modal-layer role-preview-layer">
    <section className="modal role-preview-modal" role="dialog" aria-modal="true" aria-label="Vista previa del rol" aria-describedby="role-preview-description">
      <button type="button" className="close-modal" aria-label="Cerrar vista previa" title="Cerrá la vista previa y conservá la configuración que estás editando." onClick={onClose}><Icon name="close" /></button>
      <header className="role-preview-heading"><div><p className="eyebrow">VISTA PREVIA DEL ROL</p><h2>{preview.roleName}</h2></div><span className="role-preview-badge">{dirty ? 'Borrador sin guardar' : 'Configuración guardada'}</span></header>
      <p id="role-preview-description">Recorré el menú y revisá las funciones y los avisos de este rol. Esta simulación no guarda cambios.</p>
      {preview.portalOnly && <p className="role-preview-context">Este perfil ingresa directamente al portal técnico para trabajar sobre sus servicios asignados.</p>}
      {preview.technical.configured && preview.roleCode !== 'technician' && <label className="role-preview-technical"><input type="checkbox" checked={technicalEnabled} onChange={event => setTechnicalEnabled(event.target.checked)} /><span>Empleado habilitado como técnico<small>Probá cómo cambia el acceso a Mis servicios con esta habilitación individual.</small></span></label>}
      <div className="role-preview-shell">
        <aside className="role-preview-sidebar">
          <p>MENÚ DEL ROL</p>
          <nav aria-label="Módulos del rol en vista previa">{menu.map(item => <button type="button" key={item.id} data-module-id={item.id} aria-current={section === item.id ? 'page' : undefined} title={`Revisá las funciones disponibles en ${item.label}.`} onClick={() => setSelected(item.id)}><Icon name={icons[item.id]} /><span>{item.label}</span></button>)}</nav>
          {!preview.visibleModules.length && <p className="role-preview-no-modules">Sin módulos habilitados</p>}
          {preview.helpVisible && <div className="role-preview-help"><Icon name="help" /><span>Centro de ayuda disponible</span></div>}
          <button type="button" className="role-preview-notifications-trigger" aria-pressed={section === 'notifications'} title="Revisá ejemplos de las categorías de aviso habilitadas para este rol." onClick={() => setSelected('notifications')}><Icon name="bell" /><span>Notificaciones del rol<small>{preview.enabledNotifications.length} {preview.enabledNotifications.length === 1 ? 'tipo' : 'tipos'} de aviso</small></span></button>
        </aside>
        <div className="role-preview-content">{section === 'notifications' ? <NotificationsPreview notifications={preview.notifications} /> : module && <ModulePreview module={module} technical={preview.technical} />}</div>
      </div>
      <details className="role-preview-scope"><summary>Alcance de los datos</summary><dl>{preview.scopes.map(scope => <div key={scope.id}><dt>{scope.label}</dt><dd>{scope.description}</dd></div>)}</dl><p>Las acciones sólo alcanzan registros que también se pueden consultar. Se mantienen las reglas de estado, horario y asignación de cada servicio.</p></details>
      {!!preview.hiddenModules.length && <details className="role-preview-hidden"><summary>Módulos no disponibles ({preview.hiddenModules.length})</summary><ul>{preview.hiddenModules.map(item => <li key={item.id}><Icon name="lock" size={16} /><div><b>{item.label}</b><small>{item.reason}</small></div></li>)}</ul></details>}
      <footer className="role-preview-footer"><span>{dirty ? 'El borrador se conserva. Guardá el rol cuando termines de revisarlo.' : 'Podés volver a la configuración para ajustar este rol.'}</span><button type="button" className="secondary" title="Volvé a configurar el rol sin perder el borrador." onClick={onClose}>Volver a configurar</button></footer>
    </section>
  </div>
}

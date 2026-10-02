export function requestManualRefresh({ busy, dirty, online, confirm, notify, reload }) {
  if (busy) { notify('Hay un guardado en curso. Esperá a que termine antes de actualizar.'); return false }
  if (!online) { notify('No hay conexión a Internet. Conectate antes de actualizar.'); return false }
  if (dirty && !confirm('Hay cambios sin guardar en esta pestaña. Si actualizás, se perderán esos cambios locales. ¿Querés actualizar igualmente?')) return false
  reload()
  return true
}

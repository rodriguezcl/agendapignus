import React, { useState } from "react";
import Icon from "../../components/ui/Icon.jsx";

export function Confirm({ title, detail, action, destructive, confirmLabel, close }) {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const submit = async () => {
    if (submitting) return
    setSubmitting(true)
    setError('')
    try {
      await action()
      close()
    } catch (submitError) {
      setError(submitError?.message || 'No se pudo completar la operación. Intentá nuevamente.')
      setSubmitting(false)
    }
  }
  const label = confirmLabel || (destructive ? 'Sí, eliminar' : 'Confirmar cambios')
  return <div className="modal-layer"><div className="modal confirm-modal" role="alertdialog" aria-modal="true"><span className={destructive ? 'confirm-icon danger' : 'confirm-icon'} aria-hidden="true">{destructive ? <Icon name="trash" /> : <Icon name="lock" />}</span><h2>{title}</h2><p>{detail}</p>{error && <div className="notice confirm-error" role="alert">{error}</div>}<div className="confirm-actions"><button title="Cancelá esta operación sin aplicar los cambios del formulario." type="button" className="secondary" disabled={submitting} onClick={close}><Icon name="close" size={16} />Cancelar</button><button title={submitting ? 'Esperá mientras se guarda la operación; no es necesario volver a presionar.' : `Confirmá la operación indicada: ${title}.`} type="button" className={destructive ? 'danger-button' : 'primary'} disabled={submitting} onClick={submit}>{submitting ? 'Guardando…' : label}</button></div></div></div>
}

import React, { useMemo, useState } from 'react'
import Icon from './ui/Icon.jsx'
import { softguardVerificationCases } from '../domain/customers/softguard-verification.mjs'

export default function SoftGuardVerification({ customers = [] }) {
  const [open, setOpen] = useState(false)
  const cases = useMemo(() => softguardVerificationCases(customers), [customers])
  if (!cases.length) return null
  return <>
    <button type="button" className="pending-reminder pending-reminder-softguard" title="Revisá los PIG que reaparecieron con el mismo nombre después de convertirse en CLI por una baja." onClick={() => setOpen(true)}>
      <Icon name="alert" /><div><b>Pendiente de verificación en SoftGuard: {cases.length} cuenta(s)</b><span>Hay cuentas PIG que coinciden con clientes CLI provenientes de una baja de servicio.</span></div>
    </button>
    {open && <div className="modal-layer"><section className="modal detail-modal" role="dialog" aria-modal="true" aria-labelledby="softguard-verification-title">
      <button type="button" className="close-modal" aria-label="Cerrar verificación en SoftGuard" title="Cerrá el listado de verificación sin modificar ninguna cuenta." onClick={() => setOpen(false)}><Icon name="close" /></button>
      <p className="eyebrow">CONTROL DE BAJAS</p><h2 id="softguard-verification-title">Pendiente de verificación en SoftGuard</h2>
      <p>Estos PIG siguen presentes en la agenda y coinciden en número de origen y nombre con un CLI generado por una baja. Es posible que la baja todavía no esté actualizada en SoftGuard.</p>
      <p>Verificá la cuenta en SoftGuard y corregí los registros que correspondan. Este aviso no elimina ni fusiona cuentas y permanece mientras exista la coincidencia.</p>
      <div className="softguard-verification-list">{cases.map(item => <article className="agenda-admin-note" key={item.account}>
        <strong>{item.name}</strong><p>PIG a verificar: <b>{item.account}</b></p>
        {item.clients.map(client => <p key={client.account}>CLI generado por la baja: <b>{client.account}</b> · {client.name}</p>)}
      </article>)}</div>
      <div className="modal-actions"><button type="button" className="secondary" title="Cerrá la consulta y volvé al menú principal sin modificar cuentas." onClick={() => setOpen(false)}>Cerrar</button></div>
    </section></div>}
  </>
}

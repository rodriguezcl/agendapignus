import React, { useEffect, useRef, useState } from 'react'
import { cleanSignatureHtml, signatureTextHtml } from './ticket-signature-editor.mjs'

export default function TicketMailSignature({ value, onChange, onSave, onReset, dirty, busy, configured }) {
  const editor = useRef(null)
  const [warning, setWarning] = useState('')
  useEffect(() => {
    if (editor.current && editor.current.innerHTML !== value.html) editor.current.innerHTML = cleanSignatureHtml(value.html)
  }, [value.html])
  const changed = () => onChange({ ...value, html: editor.current.innerHTML })
  const paste = event => {
    event.preventDefault()
    const rich = event.clipboardData.getData('text/html'), plain = event.clipboardData.getData('text/plain')
    if (rich.length > 50000 || plain.length > 8000) { setWarning('La firma es demasiado extensa. Copiá sólo el bloque de firma.'); return }
    const clean = cleanSignatureHtml(rich || signatureTextHtml(plain))
    setWarning(rich && /<img\b/i.test(rich) && !/<img\b/i.test(clean) ? 'La imagen no se pudo copiar. Pegá una firma cuya imagen esté disponible desde un enlace HTTPS.' : '')
    const selection = window.getSelection()
    const fragment = document.createElement('template')
    fragment.innerHTML = clean
    const last = fragment.content.lastChild
    if (selection?.rangeCount && editor.current.contains(selection.getRangeAt(0).commonAncestorContainer)) {
      const range = selection.getRangeAt(0)
      range.deleteContents(); range.insertNode(fragment.content)
      if (last) { range.setStartAfter(last); range.collapse(true); selection.removeAllRanges(); selection.addRange(range) }
    } else editor.current.append(fragment.content)
    changed()
  }
  return <form className="ticket-mail-signature" onSubmit={event => { event.preventDefault(); setWarning(''); onSave() }}>
    <header><h4>Firma de las respuestas</h4><p className="tickets-muted">Firma común del correo de soporte. Copiá la firma desde GoDaddy y pegala aquí para conservar el formato compatible.</p></header>
    <label className="tickets-checkbox"><input type="checkbox" checked={value.enabled} disabled={busy} onChange={event => onChange({ ...value, enabled: event.target.checked })} />Agregar la firma a las respuestas por correo</label>
    <div className="ticket-signature-paper"><div ref={editor} className="ticket-signature-editor" role="textbox" aria-label="Contenido de la firma" aria-multiline="true" aria-describedby="ticket-signature-help" contentEditable={!busy} suppressContentEditableWarning onInput={changed} onPaste={paste} onDrop={event => event.preventDefault()} onDragOver={event => event.preventDefault()} onClick={event => { if (event.target.closest('a')) event.preventDefault() }} data-placeholder="Escribí o pegá tu firma…" /></div>
    <p id="ticket-signature-help" className="tickets-muted">Se agrega al final de las nuevas respuestas. Las notas internas y los mensajes ya enviados conservan su contenido.</p>
    {warning && <p className="field-error" role="alert">{warning}</p>}
    {!configured && <p className="tickets-muted">Guardá primero la cuenta de correo para poder configurar su firma.</p>}
    <div className="ticket-signature-footer"><div className="tickets-actions"><button type="button" className="secondary" title="Convertí la firma a texto conservando sus saltos de línea." disabled={busy || !value.html} onClick={() => { setWarning(''); onChange({ ...value, html: signatureTextHtml(editor.current.innerText) }) }}>Quitar formato</button><button type="button" className="secondary" title="Vaciá la firma para reemplazarla. Guardá para aplicar el cambio." disabled={busy || !value.html} onClick={() => { setWarning(''); onChange({ enabled: false, html: '' }) }}>Vaciar firma</button></div><div className="tickets-actions"><button type="button" className="secondary" title="Recuperá la firma guardada y descartá los cambios de este bloque." disabled={!dirty || busy} onClick={() => { setWarning(''); onReset() }}>Descartar firma</button><button type="submit" className="primary" title="Guardá la firma común sin pausar ni modificar la conexión del correo." disabled={!dirty || busy || !configured}>Guardar firma</button></div></div>
  </form>
}

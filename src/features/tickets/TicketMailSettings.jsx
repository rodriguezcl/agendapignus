import { sortOptionsAlphabetically } from '../../domain/shared/catalog-order.mjs'
import React, { useEffect, useRef, useState } from 'react'
import { requestJson } from '../../infrastructure/http/json-request.mjs'
import useDiscardGuard from '../../components/ui/useDiscardGuard.jsx'
import { ticketDate } from './ticket-ui.mjs'
import TicketMailSignature from './TicketMailSignature.jsx'
import './ticket-mail-settings.css'

const endpoint = '/api/tickets/mail'
const testLifetime = 24 * 60 * 60 * 1000
const defaults = {
  address: '', senderName: '', mode: 'test', testSourceConfirmed: false, areaId: '',
  incoming: { protocol: 'imap', host: '', port: 993, security: 'tls', user: '', folder: 'INBOX' },
  outgoing: { protocol: 'smtp', host: '', port: 465, security: 'tls', user: '', useIncomingCredentials: true },
}
const editableSettings = settings => ({ ...defaults, ...settings,
  incoming: { ...defaults.incoming, ...settings?.incoming, password: '' },
  outgoing: { ...defaults.outgoing, ...settings?.outgoing, password: '' },
})
const freshTest = test => test?.ok && Number.isFinite(Date.parse(test.at)) && Date.now() >= Date.parse(test.at) && Date.now() - Date.parse(test.at) < testLifetime
const errorText = value => typeof value === 'string' ? value : value?.message || ''
const editableSignature = signature => ({ enabled: signature?.enabled === true, html: signature?.html || '' })

function ConfirmMailAction({ action, busy, onClose, onConfirm }) {
  const dialog = useRef(null)
  const latest = useRef({ busy, onClose })
  latest.current = { busy, onClose }
  useEffect(() => {
    const opener = document.activeElement
    const element = dialog.current
    element?.focus()
    const handleKey = event => {
      if (!element?.contains(document.activeElement)) return
      if (event.key === 'Escape' && !latest.current.busy) { event.preventDefault(); latest.current.onClose() }
      if (event.key !== 'Tab') return
      const buttons = [...element.querySelectorAll('button:not([disabled])')]
      if (!buttons.length) { event.preventDefault(); return }
      if (event.shiftKey && (document.activeElement === buttons[0] || document.activeElement === element)) { event.preventDefault(); buttons.at(-1).focus() }
      else if (!event.shiftKey && (document.activeElement === buttons.at(-1) || document.activeElement === element)) { event.preventDefault(); buttons[0].focus() }
    }
    document.addEventListener('keydown', handleKey)
    return () => { document.removeEventListener('keydown', handleKey); if (opener?.isConnected) opener.focus() }
  }, [])
  const activate = action === 'activate'
  return <div className="modal-layer tickets-dialog-layer"><section className="modal tickets-dialog ticket-mail-confirm" role="alertdialog" aria-modal="true" aria-labelledby="ticket-mail-confirm-title" aria-describedby="ticket-mail-confirm-description" tabIndex={-1} ref={dialog}>
    <h2 id="ticket-mail-confirm-title">{activate ? 'Activar correo operativo' : 'Procesar correo ahora'}</h2>
    <p id="ticket-mail-confirm-description">{activate ? 'Agentec podrá convertir los nuevos correos en tickets, enviar las respuestas solicitadas desde Tickets y las invitaciones de experiencia de instalaciones completadas. Los mensajes permanecerán en el buzón. La primera sincronización establece el punto de inicio; no incorpora correos anteriores.' : 'Se revisarán los nuevos correos y se enviarán las respuestas y las invitaciones de experiencia pendientes de Agentec. Esta acción puede enviar mensajes reales a los destinatarios de los tickets.'}</p>
    <div className="tickets-form-footer"><button type="button" className="secondary" title="Volvé a la configuración sin activar ni procesar el correo." disabled={busy} onClick={onClose}>Cancelar</button><button type="button" className="primary" title={activate ? 'Habilitá la recepción de nuevos correos y el envío de respuestas de Agentec.' : 'Revisá los correos nuevos y procesá las respuestas reales pendientes de envío.'} disabled={busy} onClick={onConfirm}>{busy ? 'Procesando…' : activate ? 'Activar correo' : 'Procesar ahora'}</button></div>
  </section></div>
}

function ConnectionTest({ test, direction, busy, disabled, onTest }) {
  const incoming = direction === 'incoming'
  const valid = freshTest(test)
  return <div className="ticket-mail-test">
    <div className={`ticket-mail-test-result ${valid ? 'is-success' : ''}`} role="status">
      <strong>{valid ? 'Conexión verificada' : test?.ok ? 'Volver a verificar la conexión' : test?.at ? 'No se pudo verificar' : 'Conexión sin verificar'}</strong>
      {test?.at && <small>{ticketDate(test.at)}</small>}
      {test?.message && <small>{test.message}</small>}
    </div>
    <button type="button" className="secondary" title={incoming ? 'Verificá el acceso IMAP y la carpeta guardada, sin descargar ni modificar correos.' : 'Verificá la autenticación del servidor SMTP guardado, sin enviar ningún correo.'} disabled={disabled} onClick={() => onTest(direction)}>{busy === `test-${direction}` ? 'Verificando…' : incoming ? 'Probar entrada' : 'Probar salida'}</button>
  </div>
}

export default function TicketMailSettings({ areas = [], onChanged }) {
  const [channel, setChannel] = useState(null), [draft, setDraft] = useState(null), [baseline, setBaseline] = useState('')
  const [signature, setSignature] = useState(editableSignature()), [signatureBaseline, setSignatureBaseline] = useState(JSON.stringify(editableSignature()))
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState(''), [confirmation, setConfirmation] = useState('')
  const lock = useRef(false), mounted = useRef(true)
  const connectionDirty = Boolean(draft && JSON.stringify(draft) !== baseline)
  const signatureDirty = JSON.stringify(signature) !== signatureBaseline
  const dirty = connectionDirty || signatureDirty
  const apply = (result, { preserveConnection = false, preserveSignature = false } = {}) => {
    const next = editableSettings(result.settings)
    setChannel(result)
    if (!preserveConnection) { setDraft(next); setBaseline(JSON.stringify(next)) }
    if (!preserveSignature) { const saved = editableSignature(result.signature); setSignature(saved); setSignatureBaseline(JSON.stringify(saved)) }
  }
  const reset = () => { if (baseline) setDraft(JSON.parse(baseline)); setSignature(JSON.parse(signatureBaseline)); setError(''); setNotice('') }
  const guard = useDiscardGuard({ dirty, busy: Boolean(busy), onDiscard: reset, title: 'Configuración de correo sin guardar' })
  const load = async () => {
    setLoading(true); setError('')
    try { const result = await requestJson(endpoint); if (mounted.current) apply(result) }
    catch (failure) { if (mounted.current) setError(failure.message) }
    finally { if (mounted.current) setLoading(false) }
  }
  useEffect(() => { mounted.current = true; load(); return () => { mounted.current = false } }, [])
  const change = patch => { setDraft(previous => ({ ...previous, ...patch })); setError(''); setNotice('') }
  const changeConnection = (direction, patch) => change({ [direction]: { ...draft[direction], ...patch } })
  const changeSecurity = (direction, security) => changeConnection(direction, { security, port: direction === 'incoming' ? (security === 'tls' ? 993 : 143) : (security === 'tls' ? 465 : 587) })
  const execute = async (action, extra = {}) => {
    if (lock.current) return
    lock.current = true; setBusy(action === 'test' ? `test-${extra.direction}` : action); setError(''); setNotice('')
    try {
      const result = await requestJson(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, version: channel.version, ...extra }) }, 'No se pudo actualizar el correo de soporte.', globalThis.fetch, 55000)
      apply(result.configuration || result, { preserveConnection: action === 'save-signature' && connectionDirty, preserveSignature: action === 'save' && signatureDirty })
      setConfirmation('')
      if (action === 'save') setNotice('Configuración guardada. Verificá ambas conexiones antes de activar el correo.')
      if (action === 'save-signature') setNotice(extra.signature.enabled ? 'Firma guardada. Se incluirá en las nuevas respuestas por correo.' : 'Firma guardada. Las nuevas respuestas se enviarán sin firma.')
      if (action === 'activate') setNotice(draft.mode === 'test' ? 'Prueba activada. No se enviarán correos a clientes.' : 'Correo operativo activado.')
      if (action === 'disable') setNotice('Correo desactivado. Los tickets existentes se conservan.')
      if (action === 'run') setNotice(result.result?.busy ? 'Ya hay un procesamiento de correo en curso. Actualizá el estado en unos instantes.' : result.result?.activated ? 'Punto de inicio establecido. Los correos que lleguen a partir de ahora se incorporarán en las próximas sincronizaciones.' : `Ciclo finalizado: ${result.result?.received || 0} correos recibidos y ${result.result?.sent || 0} respuestas enviadas.`)
      onChanged?.()
    } catch (failure) { setConfirmation(''); setError(failure.message) }
    finally { lock.current = false; setBusy('') }
  }
  const save = event => {
    event.preventDefault()
    if (!connectionDirty) return
    const settings = JSON.parse(JSON.stringify(draft))
    for (const direction of ['incoming', 'outgoing']) {
      delete settings[direction].passwordConfigured
      if (!settings[direction].password) delete settings[direction].password
    }
    execute('save', { settings })
  }
  const activate = () => draft.mode === 'live' ? setConfirmation('activate') : execute('activate')
  const run = () => channel.settings.mode === 'live' ? setConfirmation('run') : execute('run')
  const activeAreas = sortOptionsAlphabetically(areas).filter(area => area.active !== false)
  const isBusy = Boolean(busy)
  const testsReady = freshTest(channel?.tests?.incoming) && freshTest(channel?.tests?.outgoing)
  const canActivate = !dirty && !isBusy && !channel?.enabled && testsReady && (draft?.mode === 'live' || draft?.testSourceConfirmed)
  const status = channel?.status || {}
  const lastRunAt = status.lastRunAt || status.lastSuccessAt || status.lastReceivedAt
  const channelError = errorText(status.error || status.lastError)
  const scheduler = channel?.scheduler || {}
  const scheduleLabel = !scheduler.configured ? scheduler.state === 'error' ? 'Estado no disponible' : 'Sin configurar' : scheduler.active ? `Activa · cada ${scheduler.intervalMinutes || 2} minutos` : 'Programador pausado'
  const scheduleState = { waiting: 'Esperando la primera ejecución', running: 'En curso', ok: 'Completada', busy: 'Otro proceso en curso; se revisará en el próximo ciclo', error: 'No se pudo completar', stale: 'Sin ejecución reciente' }[scheduler.state]
  const scheduleWarning = scheduler.state === 'error' || (scheduler.active && scheduler.state === 'stale')
  return <section className="ticket-mail-settings" aria-label="Correo de soporte">
    <header className="tickets-section-heading"><div><h3>Correo de soporte</h3><p className="tickets-muted">Conectá el buzón que recibirá reclamos y enviará respuestas desde Tickets.</p></div><button type="button" className="secondary" title="Actualizá la configuración y el estado guardado de la conexión de correo." disabled={loading || isBusy} onClick={() => guard.requestClose(load)}>Actualizar estado</button></header>
    {error && <p className="field-error" role="alert">{error}</p>}
    {loading ? <p role="status">Cargando conexión de correo…</p> : draft && <>
      <div className="ticket-mail-status-row"><span className={`ticket-mail-status ${channel.enabled ? 'is-active' : ''}`}>{channel.enabled ? channel.settings.mode === 'test' ? 'Prueba activa' : 'Correo activo' : channel.configured ? 'Correo desactivado' : 'Sin configurar'}</span><span>{channel.settings.mode === 'live' ? 'Modo operativo' : 'Modo de prueba · sin envíos'}</span>{channel.updatedAt && <small>Actualizado: {ticketDate(channel.updatedAt)}</small>}</div>
      {!channel.encryptionReady && <p className="tickets-feedback" role="status">El servidor necesita habilitar el cifrado de credenciales para poder guardar esta conexión. Solicitá esta configuración al responsable de mantenimiento.</p>}
      <form className="ticket-mail-form" onSubmit={save} autoComplete="off">
        <fieldset className="ticket-mail-general" disabled={isBusy || !channel.encryptionReady}>
          <legend>Cuenta de correo</legend>
          <div className="ticket-mail-identity"><label>Dirección de soporte<input type="email" required maxLength={254} value={draft.address} onChange={event => change({ address: event.target.value })} placeholder="soporte@pignusarg.com" autoComplete="off" /></label><label>Nombre del remitente<input type="text" required maxLength={120} value={draft.senderName} onChange={event => change({ senderName: event.target.value })} placeholder="Soporte · Pignus" /></label><label>Área de destino<select required value={draft.areaId} onChange={event => change({ areaId: event.target.value })}><option value="">Seleccionar área</option>{activeAreas.map(area => <option value={area.id} key={area.id}>{area.name}</option>)}</select></label></div>
          <div className="ticket-mail-mode"><label>Modo de funcionamiento<select value={draft.mode} onChange={event => change({ mode: event.target.value, testSourceConfirmed: false })}><option value="live">Operativo · recepción y envío</option><option value="test">Prueba · no envía correos</option></select></label><p className="tickets-muted">{draft.mode === 'test' ? 'Usá un buzón o una carpeta de prueba separados del circuito real. Los tickets de prueba quedan identificados.' : 'Se crearán tickets con los correos nuevos y se habilitarán las respuestas a sus remitentes.'}</p></div>
          {draft.mode === 'test' && <label className="tickets-checkbox ticket-mail-isolated"><input type="checkbox" checked={draft.testSourceConfirmed} onChange={event => change({ testSourceConfirmed: event.target.checked })} />Confirmo que el buzón o la carpeta seleccionada se utiliza para pruebas y está separada del circuito real.</label>}
        </fieldset>
        <div className="ticket-mail-connections">
          <section className="ticket-mail-card" aria-labelledby="ticket-mail-incoming-title"><header><span className="ticket-mail-direction" aria-hidden="true">↙</span><div><h4 id="ticket-mail-incoming-title">Correo entrante</h4><p>Recepción de reclamos · IMAP</p></div></header><fieldset disabled={isBusy || !channel.encryptionReady} aria-label="Servidor de correo entrante"><div className="ticket-mail-fields"><label className="ticket-mail-full">Servidor IMAP<input type="text" required value={draft.incoming.host} maxLength={253} onChange={event => changeConnection('incoming', { host: event.target.value })} placeholder="imap.secureserver.net" autoCapitalize="none" spellCheck={false} /></label><label className="ticket-mail-full">Usuario de entrada<input type="text" required value={draft.incoming.user} maxLength={254} onChange={event => changeConnection('incoming', { user: event.target.value })} placeholder="soporte@pignusarg.com" autoComplete="off" autoCapitalize="none" spellCheck={false} /></label><label className="ticket-mail-full">Contraseña de entrada<input type="password" aria-label="Contraseña de entrada" aria-describedby="ticket-mail-incoming-password-help" value={draft.incoming.password} maxLength={1024} onChange={event => changeConnection('incoming', { password: event.target.value })} placeholder={channel.settings.incoming.passwordConfigured ? 'Guardada · dejar vacío para conservar' : 'Ingresar contraseña'} autoComplete="new-password" /><small id="ticket-mail-incoming-password-help">{channel.settings.incoming.passwordConfigured ? 'Al cambiar el servidor, usuario o dirección de soporte, ingresá nuevamente la contraseña.' : 'Se guarda cifrada y nunca se vuelve a mostrar.'}</small></label><label>Seguridad<select value={draft.incoming.security} onChange={event => changeSecurity('incoming', event.target.value)}><option value="tls">SSL/TLS</option><option value="starttls">STARTTLS</option></select></label><label>Puerto<input type="number" readOnly value={draft.incoming.port} /><small>993 para SSL/TLS · 143 para STARTTLS.</small></label><label className="ticket-mail-full">Carpeta del buzón<input type="text" required value={draft.incoming.folder} maxLength={255} onChange={event => changeConnection('incoming', { folder: event.target.value })} placeholder="INBOX" /><small>La primera sincronización fija el inicio: se incorporarán sólo los correos posteriores.</small></label></div></fieldset><p className="ticket-mail-security-note">Verificación de certificado obligatoria · Los mensajes se conservan en el servidor.</p><ConnectionTest test={channel.tests?.incoming} direction="incoming" busy={busy} disabled={dirty || isBusy || !channel.configured || !channel.encryptionReady} onTest={direction => execute('test', { direction })} /></section>
          <section className="ticket-mail-card" aria-labelledby="ticket-mail-outgoing-title"><header><span className="ticket-mail-direction" aria-hidden="true">↗</span><div><h4 id="ticket-mail-outgoing-title">Correo saliente</h4><p>Respuestas a tickets · SMTP</p></div></header><fieldset disabled={isBusy || !channel.encryptionReady} aria-label="Servidor de correo saliente"><div className="ticket-mail-fields"><label className="ticket-mail-full">Servidor SMTP<input type="text" required value={draft.outgoing.host} maxLength={253} onChange={event => changeConnection('outgoing', { host: event.target.value })} placeholder="smtpout.secureserver.net" autoCapitalize="none" spellCheck={false} /></label><label className="tickets-checkbox ticket-mail-full ticket-mail-shared"><input type="checkbox" checked={draft.outgoing.useIncomingCredentials} onChange={event => changeConnection('outgoing', { useIncomingCredentials: event.target.checked, password: '' })} />Usar el usuario y la contraseña de entrada</label>{!draft.outgoing.useIncomingCredentials && <><label className="ticket-mail-full">Usuario de salida<input type="text" required value={draft.outgoing.user} maxLength={254} onChange={event => changeConnection('outgoing', { user: event.target.value })} placeholder="soporte@pignusarg.com" autoComplete="off" autoCapitalize="none" spellCheck={false} /></label><label className="ticket-mail-full">Contraseña de salida<input type="password" aria-label="Contraseña de salida" aria-describedby="ticket-mail-outgoing-password-help" value={draft.outgoing.password} maxLength={1024} onChange={event => changeConnection('outgoing', { password: event.target.value })} placeholder={channel.settings.outgoing.passwordConfigured ? 'Guardada · dejar vacío para conservar' : 'Ingresar contraseña'} autoComplete="new-password" /><small id="ticket-mail-outgoing-password-help">{channel.settings.outgoing.passwordConfigured ? 'Al cambiar el servidor, usuario o dirección de soporte, ingresá nuevamente la contraseña.' : 'Se guarda cifrada y nunca se vuelve a mostrar.'}</small></label></>}<label>Seguridad<select value={draft.outgoing.security} onChange={event => changeSecurity('outgoing', event.target.value)}><option value="tls">SSL/TLS</option><option value="starttls">STARTTLS</option></select></label><label>Puerto<input type="number" readOnly value={draft.outgoing.port} /><small>465 para SSL/TLS · 587 para STARTTLS.</small></label></div></fieldset><p className="ticket-mail-security-note">Verificación de certificado obligatoria · Probar la conexión no envía mensajes.</p><ConnectionTest test={channel.tests?.outgoing} direction="outgoing" busy={busy} disabled={dirty || isBusy || !channel.configured || !channel.encryptionReady} onTest={direction => execute('test', { direction })} /></section>
        </div>
        <div className="ticket-mail-save"><p className="tickets-muted">{connectionDirty ? 'Hay cambios sin guardar. Guardar desactiva la conexión hasta que vuelvas a verificarla y activarla.' : 'Para activar el correo, ambas conexiones deben haber sido verificadas en las últimas 24 horas.'}</p><div className="tickets-actions"><button type="button" className="secondary" title="Descartá los cambios del correo y recuperá la configuración guardada." disabled={!connectionDirty || isBusy} onClick={() => guard.requestClose(() => { setDraft(JSON.parse(baseline)); setError(''); setNotice('') })}>Descartar cambios</button><button type="submit" className="primary" title="Guardá los datos del buzón y sus credenciales sin activar la conexión de correo." disabled={!connectionDirty || isBusy || !channel.encryptionReady}>{busy === 'save' ? 'Guardando…' : 'Guardar correo'}</button></div></div>
      </form>
      <TicketMailSignature value={signature} onChange={value => { setSignature(value); setError(''); setNotice('') }} onSave={() => execute('save-signature', { signature })} onReset={() => guard.requestClose(() => setSignature(JSON.parse(signatureBaseline)))} dirty={signatureDirty} busy={isBusy} configured={channel.configured} />
      <section className="ticket-mail-operation" aria-label="Funcionamiento del correo"><div className="ticket-mail-operation-heading"><div><h4>Funcionamiento</h4><p className="tickets-muted">{channel.enabled ? 'Podés procesar un ciclo de correo ahora o consultar la ejecución automática.' : scheduler.active ? 'La programación sigue activa; no recibe ni envía mensajes mientras el correo está desactivado.' : 'Guardá y probá la conexión antes de habilitar el procesamiento.'}</p></div><div className="tickets-actions">{channel.enabled ? <button type="button" className="secondary" title="Detené la recepción y el envío de correo de Agentec sin borrar sus tickets." disabled={isBusy || dirty} onClick={() => execute('disable')}>{busy === 'disable' ? 'Desactivando…' : 'Desactivar correo'}</button> : <button type="button" className="primary" title="Activá la configuración guardada luego de verificar ambas conexiones de correo." disabled={!canActivate} onClick={activate}>{busy === 'activate' ? 'Activando…' : draft.mode === 'test' ? 'Activar prueba' : 'Activar correo'}</button>}<button type="button" className="secondary" title="Ejecutá un ciclo del correo configurado: recibí nuevos mensajes y procesá sus respuestas pendientes." disabled={!channel.enabled || isBusy || dirty} onClick={run}>{busy === 'run' ? 'Procesando…' : 'Procesar ahora'}</button></div></div>
        <dl className="ticket-mail-runtime"><div><dt>Última sincronización correcta</dt><dd>{lastRunAt ? ticketDate(lastRunAt) : 'Todavía sin ejecuciones'}</dd></div><div><dt>Ejecución automática</dt><dd>{scheduleLabel}{scheduler.configured && <><p className="tickets-muted">{scheduler.lastAttemptAt ? `Último intento: ${ticketDate(scheduler.lastAttemptAt)}` : 'Todavía sin intentos registrados'}</p>{scheduleState && <p className="tickets-muted">{scheduleState}</p>}{scheduler.lastCompletedAt && <p className="tickets-muted">Última finalización: {ticketDate(scheduler.lastCompletedAt)}</p>}</>}</dd></div>{status.outbound && <div><dt>Respuestas pendientes / con error</dt><dd>{(status.outbound.queued || 0) + (status.outbound.retry || 0)} / {(status.outbound.failed || 0) + (status.outbound.uncertain || 0)}</dd></div>}</dl>{scheduleWarning && <p role="alert" className="field-error">{scheduler.message || (scheduler.state === 'stale' ? 'No se registran ejecuciones automáticas recientes. Actualizá el estado y solicitá revisar la programación si el aviso continúa.' : 'La última ejecución automática no pudo completarse. Actualizá el estado y solicitá revisar la conexión si el aviso continúa.')}</p>}{channelError && <p role="alert" className="field-error">{channelError}</p>}
      </section>
    </>}
    {notice && <p className="tickets-feedback" role="status">{notice}</p>}
    {confirmation && <ConfirmMailAction action={confirmation} busy={isBusy} onClose={() => setConfirmation('')} onConfirm={() => execute(confirmation, { confirmSend: confirmation === 'run' })} />}
    {guard.discardDialog}
  </section>
}

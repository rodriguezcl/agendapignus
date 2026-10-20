import '../../../login.css'
import React, { useState, useRef } from "react";
import { readSettledLoginCredentials } from "../application/login-autofill.mjs";
import { fetchAuthWithRetry, AUTH_LOGIN_TIMEOUT_MS, fetchWithTimeout } from "../../../infrastructure/http/fetch-timeout.mjs";
import LoginScene from "../../../components/LoginScene.jsx";
import RequiredLabel from "../../../presentation/components/forms/RequiredLabel.jsx";
import Icon from "../../../components/ui/Icon.jsx";

export function Login({ onLogin, initialError = '' }) {
  const [email, setEmail] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState(initialError)
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [requestingReset, setRequestingReset] = useState(false)
  const submissionInProgressRef = useRef(false)
  const submit = async event => {
    event.preventDefault()
    if (submissionInProgressRef.current) return
    submissionInProgressRef.current = true
    const form = event.currentTarget
    setError('')
    setMessage('')
    setSubmitting(true)
    try {
      const credentials = await readSettledLoginCredentials(form)
      const response = await fetchAuthWithRetry('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(credentials) }, AUTH_LOGIN_TIMEOUT_MS)
      const data = await response.json().catch(() => ({ error: 'La base de datos todavía está iniciando. Esperá un momento e intentá nuevamente.' }))
      if (!response.ok) throw new Error(data.error || 'No se pudo iniciar sesión.')
      form.reset()
      setEmail('')
      onLogin(data.user, data.state)
    } catch (loginError) { setError(loginError.message) }
    finally { submissionInProgressRef.current = false; setSubmitting(false) }
  }
  const requestPasswordReset = async () => {
    setError(''); setMessage('')
    if (!email.trim()) return setError('Ingresá tu correo electrónico para solicitar el cambio de contraseña.')
    setRequestingReset(true)
    try {
      const response = await fetchWithTimeout('/api/auth/password-reset-requests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) })
      const data = await response.json().catch(() => ({ error: 'No se pudo registrar la solicitud.' }))
      if (!response.ok) throw new Error(data.error || 'No se pudo registrar la solicitud.')
      setMessage(data.message || 'La solicitud fue enviada al Administrador.')
    } catch (requestError) { setError(requestError.message) }
    finally { setRequestingReset(false) }
  }
  return <LoginScene><form className="login-card" onSubmit={submit}><img src="/logo-pignus.png" alt="Pignus" /><p className="eyebrow">ACCESO SEGURO</p><h1>Ingresá a Agenda técnica</h1><p>Usá el correo y la contraseña definidos por el administrador.</p><label htmlFor="login-email"><RequiredLabel>Correo electrónico</RequiredLabel><input id="login-email" name="email" required autoCapitalize="none" autoCorrect="off" autoComplete="username" type="email" defaultValue="" onInput={event => setEmail(event.currentTarget.value)} /></label><label htmlFor="login-password"><RequiredLabel>Contraseña</RequiredLabel></label><div className="password-field"><input id="login-password" name="password" aria-label="Contraseña" required autoComplete="current-password" minLength="8" type={showPassword ? 'text' : 'password'} defaultValue="" /><button title={showPassword ? 'Ocultá los caracteres de tu contraseña en pantalla.' : 'Mostrá los caracteres de tu contraseña para revisar lo que escribiste.'} type="button" className="password-visibility" aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'} aria-pressed={showPassword} onClick={() => setShowPassword(value => !value)}><Icon name="eye" size={17} /><span>{showPassword ? 'Ocultar' : 'Mostrar'}</span></button></div><button title="Solicitá ayuda para restablecer el acceso a tu cuenta." type="button" className="forgot-password" disabled={requestingReset || submitting} onClick={requestPasswordReset}>{requestingReset ? 'Enviando solicitud...' : 'Olvidé mi contraseña'}</button>{error && <p className="login-error" role="alert">{error}</p>}{message && <p className="login-success" role="status">{message}</p>}<button title="Ingresá a la plataforma con tu usuario y contraseña." className="primary" disabled={submitting || requestingReset}>{submitting ? 'Verificando acceso...' : 'Iniciar sesión'}</button><small>El acceso se cierra automáticamente al finalizar la sesión.</small></form></LoginScene>
}

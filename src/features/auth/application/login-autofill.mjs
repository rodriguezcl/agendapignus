export const LOGIN_AUTOFILL_SETTLE_MS = 150

/**
 * Safari puede enviar el formulario mientras el gestor de contraseñas todavía
 * está escribiendo los valores autenticados. La pausa ocurre antes de leer el
 * DOM para capturar las credenciales definitivas, no una copia anterior de React.
 */
export async function readSettledLoginCredentials(form, wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))) {
  await wait(LOGIN_AUTOFILL_SETTLE_MS)
  return {
    email: String(form?.elements?.email?.value || '').trim(),
    password: String(form?.elements?.password?.value || '')
  }
}

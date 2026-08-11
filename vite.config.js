
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const securityHeaders = {
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
}

// Vite inserta el preámbulo de React Refresh como un módulo inline solamente
// durante el desarrollo. El servidor sigue limitado a localhost; la vista de
// producción conserva la CSP estricta definida arriba.
const developmentSecurityHeaders = {
  ...securityHeaders,
  'Content-Security-Policy': securityHeaders['Content-Security-Policy'].replace("script-src 'self'", "script-src 'self' 'unsafe-inline'"),
}

export default defineConfig({
  plugins: [react()],
  server: { host: '127.0.0.1', headers: developmentSecurityHeaders, proxy: { '/api': 'http://127.0.0.1:3001' } },
  preview: { host: '127.0.0.1', headers: securityHeaders, proxy: { '/api': 'http://127.0.0.1:3001' } },
})

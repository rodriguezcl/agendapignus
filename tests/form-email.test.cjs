const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const source = fs.readFileSync(require.resolve('../src/App.jsx'), 'utf8')
const start = source.indexOf('const normalizeFormValue =')
const end = source.indexOf('const requiresPaymentAmount =', start)
const { applicableServiceExtras, invalidFormEmail } = vm.runInNewContext(source.slice(start, end) + '\n({ applicableServiceExtras, invalidFormEmail })', {
  normalizeServiceName: value => String(value || '').toLowerCase(),
  serviceCode: service => service.code,
  FORM_OPTIONS: ['Completo', 'Incompleto (Abonado completa a mano)'],
  PAYMENT_SERVICE_NAMES: new Set()
})
const service = { code: 'alarm-installation', name: 'Instalación de alarma' }

test('email applies only to complete forms, supports legacy spelling and trims whitespace', () => {
  for (const form of ['Completo', 'Completado']) {
    assert.equal(applicableServiceExtras({ form, formEmail: ' cliente@example.com ' }, service).formEmail, 'cliente@example.com')
  }
  for (const form of ['', 'Incompleto (Abonado completa a mano)']) {
    assert.equal(applicableServiceExtras({ form, formEmail: 'cliente@example.com' }, service).formEmail, '')
  }
  assert.equal(applicableServiceExtras({ form: 'Completo', formEmail: 'cliente@example.com' }, { code: 'other' }).formEmail, '')
})

test('optional email validates format when supplied', () => {
  assert.equal(invalidFormEmail({ form: 'Completo', formEmail: '' }, service), false)
  assert.equal(invalidFormEmail({ form: 'Completo', formEmail: 'cliente@example.com' }, service), false)
  assert.equal(invalidFormEmail({ form: 'Completo', formEmail: 'correo-invalido' }, service), true)
})

test('editing email marks service dirty and discard restores previous email', async () => {
  const { serviceHasChanges, restoreSavedService } = await import('../src/domain/agenda/service-changes.mjs')
  const saved = { id: '1', form: 'Completo', formEmail: 'anterior@example.com' }
  const draft = { ...saved, formEmail: 'nuevo@example.com' }
  assert.equal(serviceHasChanges(draft, saved), true)
  assert.equal(restoreSavedService(draft, saved).formEmail, saved.formEmail)
})

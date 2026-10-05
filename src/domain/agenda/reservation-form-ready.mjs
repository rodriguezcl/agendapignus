export const reservationFormReady = record => Boolean(
  record?.subscriberReservation &&
  String(record.form || '').trim() === 'Completo' &&
  String(record.formEmail || '').trim()
)

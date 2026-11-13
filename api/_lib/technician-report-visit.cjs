// A report belongs to the visit the technician opened, not a later booking
// that happens to reuse the same service ID.
function assertReportVisit(record, visit) {
  const fields = ['date', 'time', 'reprogrammedAt']
  const value = (item, key) => String((key === 'time' ? item?.time || item?.scheduledTime : item?.[key]) || '')
  if ((!visit && record.reprogrammedAt) || (visit && fields.some(key => value(record, key) !== value(visit, key)))) {
    throw Object.assign(new Error('El servicio fue reprogramado o cambió de horario desde que abriste el informe. Actualizá la agenda y revisá la nueva visita antes de informar.'), { statusCode: 409, code: 'TECHNICIAN_VISIT_CHANGED' })
  }
}
module.exports = { assertReportVisit }

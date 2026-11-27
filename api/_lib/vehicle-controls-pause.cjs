function vehicleControlsPaused(weekly = {}) {
  return weekly?._vehicleControls?.paused === true
}

function isVehicleControl(record) {
  return Boolean(record?.vehicleControl || record?.serviceId === 'vehicle-weekly-control')
}

// Hiding an open control is an operational pause, never a history deletion.
function pausedVehicleControl(record, weekly = {}) {
  return vehicleControlsPaused(weekly) && isVehicleControl(record) &&
    !record.completedAt && !record.technicalStatus && !record.technicalReportedAt &&
    !['Completado', 'Cancelado', 'Reprogramado', 'Avance registrado'].includes(record.status)
}
function hiddenAgendaControl(record, weekly) {
  return (record?.vehicleControlSkippedDuringPause === true && record.status === 'Cancelado') || pausedVehicleControl(record, weekly)
}
module.exports = { vehicleControlsPaused, isVehicleControl, pausedVehicleControl, hiddenAgendaControl }

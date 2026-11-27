function vehicleControlsPaused(weekly = {}) {
  return weekly?._vehicleControls?.paused === true
}

// Hiding an open control is an operational pause, never a history deletion.
function pausedVehicleControl(record, weekly = {}) {
  return vehicleControlsPaused(weekly) && Boolean(record?.vehicleControl || record?.serviceId === 'vehicle-weekly-control') &&
    !record.completedAt && !record.technicalStatus && !record.technicalReportedAt &&
    !['Completado', 'Cancelado', 'Reprogramado', 'Avance registrado'].includes(record.status)
}
function hiddenAgendaControl(record, weekly) {
  return (record?.vehicleControlSkippedDuringPause === true && record.status === 'Cancelado') || pausedVehicleControl(record, weekly)
}
module.exports = { vehicleControlsPaused, pausedVehicleControl, hiddenAgendaControl }

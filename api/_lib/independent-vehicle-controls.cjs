// Controls are individual assignments, not work performed by the entire team.
// Missing or ambiguous responsibility must never bypass conflict validation.
function independentVehicleControls(first, second) {
  if (!first?.vehicleControl || !second?.vehicleControl) return false
  if (!first.vehicleId || !second.vehicleId || String(first.vehicleId) === String(second.vehicleId)) return false
  const left = first.technicianIds || []
  const right = second.technicianIds || []
  return left.length === 1 && right.length === 1 && Boolean(left[0]) && Boolean(right[0]) && String(left[0]) !== String(right[0])
}
module.exports = { independentVehicleControls }

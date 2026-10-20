// Only snapshots read from normalized storage may bypass credential repair.
// Keep the observed values separate from mutable application state so sharing
// an employee array never hides an in-place credential change.
const snapshots = new WeakMap()

const signature = employees => JSON.stringify((employees || [])
  .filter(employee => employee.passwordHash)
  .map(employee => [String(employee.id), employee.passwordHash])
  .sort(([left], [right]) => left.localeCompare(right)))

function rememberNormalizedCredentials(state) {
  snapshots.set(state, signature(state.employees))
  return state
}

function normalizedCredentialsUnchanged(previous, next) {
  return previous.employees === next.employees && snapshots.has(previous) &&
    snapshots.get(previous) === signature(next.employees)
}

module.exports = { rememberNormalizedCredentials, normalizedCredentialsUnchanged }

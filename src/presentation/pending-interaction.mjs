// Give React a frame to present local feedback before command preparation runs.
export function afterInteractionPaint() {
  return new Promise(resolve => {
    if (typeof requestAnimationFrame !== 'function' || globalThis.document?.hidden) {
      setTimeout(resolve, 0)
    } else {
      requestAnimationFrame(() => setTimeout(resolve, 0))
    }
  })
}

export function acknowledgedInteraction(preview, payload) {
  const revision = Number(payload?.state?.revision ?? payload?.revision)
  return { ...preview, phase: 'acknowledged', revision: Number.isFinite(revision) && revision > 0 ? revision : null }
}

// A command can finish before App publishes its batch's confirmed state.
// Keep the preview until that revision arrives, including a newer remote edit.
export function interactionIsConfirmed(preview, confirmedRevision, valueMatches) {
  if (preview?.phase !== 'acknowledged') return false
  if (preview.revision !== null && Number.isFinite(Number(confirmedRevision))) {
    return Number(confirmedRevision) >= preview.revision
  }
  return valueMatches
}

export function weeklyTeamInteractionKey(day, teamId, teamIndex) {
  return JSON.stringify([day, teamId ? String(teamId) : `index:${teamIndex}`])
}

export function membershipMatches(team, preview) {
  const sameItems = (left = [], right = []) => left.length === right.length && left.every(value => right.some(item => String(item) === String(value)))
  return Boolean(team) && sameItems(team.memberIds, preview.memberIds) && sameItems(team.members, preview.members)
}

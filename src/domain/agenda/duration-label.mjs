export function durationLabel(value) {
  const total = Number(value)
  if (!Number.isFinite(total) || total < 0) return 'Sin información'
  const minutes = Math.round(total)
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`
}

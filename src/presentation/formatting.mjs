export const currentLocalDate = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' })

export const prettyDate = value => value ? new Date(`${value}T12:00:00`).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).replace(/^./, x => x.toUpperCase()) : ''

export const initials = name => name.split(' ').map(x => x[0]).slice(0, 2).join('').toUpperCase()

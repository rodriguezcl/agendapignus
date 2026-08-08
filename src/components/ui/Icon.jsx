import React from 'react'

/**
 * Icono SVG reutilizable para toda la interfaz.
 * Mantener el mapa de trazos centralizado evita duplicar SVGs en cada módulo.
 */
const paths = {
  menu: 'M3 6h18M3 12h18M3 18h18',
  dashboard: 'M4 4h6v7H4zm10 0h6v11h-6zM4 15h6v5H4zm10 4v-4h6v4z',
  agenda: 'M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2m4 10 2 2 4-4',
  history: 'M3 12a9 9 0 1 0 3-6.7M3 4v5h5m4-4v7l4 2',
  calendar: 'M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m18-8a4 4 0 1 0 0-8m-2 2a4 4 0 1 0-8 0',
  accounts: 'M4 4h16v16H4zM8 8h8M8 12h8M8 16h5',
  tools: 'm14.7 6.3 3-3a4 4 0 0 1-5.2 5.2l-7.3 7.3a2 2 0 1 0 2.8 2.8l7.3-7.3a4 4 0 0 1 5.2-5.2l-3 3',
  settings: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm0-13v2m0 15v2m9.5-9.5h-2m-15 0h-2m16.2-6.7-1.4 1.4M6.7 17.3l-1.4 1.4m13.4 0-1.4-1.4M6.7 6.7 5.3 5.3', logout: 'M10 17l5-5-5-5m5 5H3m9-9h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6', copy: 'M9 8h10v12H9zM5 16H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1', eye: 'M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6', plus: 'M12 5v14M5 12h14', edit: 'm4 16.5-.5 4 4-.5L19 8.5l-3.5-3.5L4 16.5ZM13.5 7l3.5 3.5', trash: 'M4 7h16m-10 4v6m4-6v6M9 7l1-3h4l1 3m-9 0 1 14h10l1-14', upload: 'M12 16V3m0 0L7 8m5-5 5 5M4 14v5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5', search: 'm21 21-4.5-4.5m2-5a7 7 0 1 1-14 0 7 7 0 0 1 14 0', moon: 'M20 15.5A8.5 8.5 0 0 1 8.5 4 8.5 8.5 0 1 0 20 15.5Z', sun: 'M12 3v2m0 14v2M3 12h2m14 0h2m-3.6-5.4 1.4-1.4M5.2 18.8l1.4-1.4m0-10.8L5.2 5.2m13.6 13.6-1.4-1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0', close: 'M6 6l12 12M18 6 6 18', check: 'm5 12 4 4L19 6', lock: 'M6 10V7a6 6 0 0 1 12 0v3M5 10h14v11H5z'
}

export default function Icon({ name, size = 18 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] || paths.settings} /></svg>
}

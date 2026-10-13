import React from 'react'

const timestamp = value => {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })
}

export default function ReschedulingHistory({ record }) {
  if (!record?.reschedulingHistory?.length) return null
  return <details className="journey-history"><summary>Visitas anteriores y reprogramaciones</summary>{record.reschedulingHistory.map((visit, index) => <article key={`${visit.reprogrammedAt}-${index}`}>
    <b>{visit.date?.split('-').reverse().join('/')}{visit.time ? ` · ${visit.time} Hs` : ''}</b>
    {(visit.team || visit.technicians?.length) && <p>{[visit.team, visit.technicians?.join(' / ')].filter(Boolean).join(' · ')}</p>}
    {visit.startedAt && <p>Inicio registrado: {timestamp(visit.startedAt)}{visit.startedByName ? ` · ${visit.startedByName}` : ''}</p>}
    {visit.technicalObservation && <p className="journey-report">{visit.technicalObservation}</p>}
    <small>Reprogramado: {timestamp(visit.reprogrammedAt)}</small>
  </article>)}</details>
}

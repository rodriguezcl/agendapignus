import React from 'react'
import './cctv-requirement.css'

export default function CctvRequirement({ record }) {
  if (!record.customerCctvRequirement) return null
  return <aside className="cctv-requirement" aria-label="Requerimiento de CCTV">
    <strong>Requerimiento de CCTV</strong>
    <span>{record.customerCctvRequirement}</span>
  </aside>
}

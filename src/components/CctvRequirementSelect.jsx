import React from 'react'
import requirements from '../../shared/cctv-requirements.json'

export default function CctvRequirementSelect({ value, onChange, disabled, emptyLabel = 'Sin especificar' }) {
  return <label>Requerimiento
    <select value={value || ''} onChange={onChange} disabled={disabled}>
      <option value="">{emptyLabel}</option>
      {requirements.map(requirement => <option key={requirement} value={requirement}>{requirement}</option>)}
    </select>
  </label>
}

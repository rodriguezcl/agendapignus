import React from 'react'
import requirements from '../../shared/cctv-requirements.json'

export default function CctvRequirementSelect({ value, onChange, detail, onDetailChange, disabled, emptyLabel = 'Sin especificar' }) {
  return <>
    <label>Requerimiento
      <select value={value || ''} onChange={onChange} disabled={disabled}>
        <option value="">{emptyLabel}</option>
        {requirements.map(requirement => <option key={requirement} value={requirement}>{requirement}</option>)}
      </select>
    </label>
    {value === 'Otro' && <label>Detalle del requerimiento
        <textarea rows={3} maxLength={1000} value={detail || ''} onChange={onDetailChange} disabled={disabled} />
      </label>}
  </>
}

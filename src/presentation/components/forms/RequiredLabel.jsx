import React from 'react'

export default function RequiredLabel({ children, required = true }) {
  return <span className="field-label-text">{children}{required && <span className="required-mark" aria-hidden="true">*</span>}</span>
}

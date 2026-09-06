import React from 'react'

export default function RequiredLabel({ children }) {
  return <span className="field-label-text">{children}<span className="required-mark" aria-hidden="true">*</span></span>
}

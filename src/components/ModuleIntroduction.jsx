import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

// Keep each module's contextual guidance (including role-specific messages)
// alongside the shell title, rather than maintaining a second copy of it.
export default function ModuleIntroduction({ children }) {
  const [target, setTarget] = useState(null)
  useEffect(() => { setTarget(document.getElementById('module-description-slot')) }, [])
  if (!target) return <div>{children}</div>
  const description = React.Children.toArray(children).find(child => child.type === 'p' && child.props.className !== 'eyebrow')
  return <><span className="module-intro-placeholder" hidden />{description && createPortal(<div className="topbar-module-description">{description.props.children}</div>, target)}</>
}

import React, { useLayoutEffect, useState } from 'react'
import { createPortal } from 'react-dom'

// Keep each module's contextual guidance (including role-specific messages)
// alongside the shell title, rather than maintaining a second copy of it.
export default function ModuleIntroduction({ children }) {
  const [target, setTarget] = useState(null)
  // The shell already renders the title. Never paint a temporary copy in the
  // content; resolve the description portal before the browser's first paint.
  useLayoutEffect(() => { setTarget(document.getElementById('module-description-slot')) }, [])
  const description = React.Children.toArray(children).find(child => child.type === 'p' && child.props.className !== 'eyebrow')
  return <><span className="module-intro-placeholder" hidden />{target && description && createPortal(<div className="topbar-module-description">{description.props.children}</div>, target)}</>
}

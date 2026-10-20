import React, { useEffect, useId, useMemo, useState } from 'react'
import Icon from '../../../components/ui/Icon.jsx'
import './sidebar-navigation.css'

const COLLAPSIBLE_SECTIONS = {
  resources: { label: 'Recursos', icon: 'tools' },
  administration: { label: 'Administración', icon: 'settings' }
}

function readOpenSections(storageKey) {
  try {
    const saved = JSON.parse(window.localStorage.getItem(storageKey) || '{}')
    return Object.fromEntries(Object.keys(COLLAPSIBLE_SECTIONS).map(section => [section, saved?.[section] === true]))
  } catch {
    return {}
  }
}

function groupItems(items) {
  const groups = []
  const bySection = new Map()
  for (const item of items) {
    if (item.id === 'help') continue
    if (!item.section) {
      groups.push({ id: item.id, items: [item] })
      continue
    }
    let group = bySection.get(item.section)
    if (!group) {
      group = {
        id: item.section,
        label: item.sectionLabel,
        collapsible: Boolean(item.collapsible && COLLAPSIBLE_SECTIONS[item.section]),
        items: []
      }
      bySection.set(item.section, group)
      groups.push(group)
    }
    group.items.push(item)
  }
  return groups
}

function SidebarNavigationMenu({ items, activeId, onNavigate, storageKey, compact, onExpand }) {
  const idPrefix = useId()
  const groups = useMemo(() => groupItems(items), [items])
  const activeGroup = groups.find(group => group.collapsible && group.items.length > 1 && group.items.some(item => item.id === activeId))?.id
  const help = items.find(item => item.id === 'help')
  const [openSections, setOpenSections] = useState(() => ({
    ...readOpenSections(storageKey),
    ...(activeGroup ? { [activeGroup]: true } : {})
  }))

  useEffect(() => {
    if (!activeGroup) return
    setOpenSections(current => current[activeGroup] ? current : { ...current, [activeGroup]: true })
  }, [activeId, activeGroup])

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(openSections))
    } catch {
      // Navigation remains usable when browser storage is unavailable.
    }
  }, [openSections, storageKey])

  const renderItem = (item, nested = false) => (
    <button
      key={item.id}
      type="button"
      className={`sidebar-navigation-button${nested ? ' sidebar-navigation-child' : ''}${activeId === item.id ? ' active' : ''}`}
      aria-current={activeId === item.id ? 'page' : undefined}
      aria-label={item.label}
      title={item.label}
      onClick={() => onNavigate(item.id)}
    >
      <Icon name={item.icon} />
      <span className="nav-item-label">{item.label}</span>
    </button>
  )

  const toggleSection = section => {
    setOpenSections(current => ({ ...current, [section]: compact || !current[section] }))
    if (compact) onExpand?.()
  }

  return (
    <nav className={`sidebar-navigation${compact ? ' is-compact' : ''}`} aria-label="Navegación de módulos">
      <div className="sidebar-navigation-menu">
        {groups.map(group => {
          const disclosure = group.collapsible && group.items.length > 1
          const sectionId = `${idPrefix}-${group.id}`
          const labelId = `${sectionId}-label`
          if (disclosure) {
            const details = COLLAPSIBLE_SECTIONS[group.id]
            const expanded = Boolean(openSections[group.id] && !compact)
            const containsActive = group.items.some(item => item.id === activeId)
            return (
              <section key={group.id} className="sidebar-navigation-section sidebar-navigation-disclosure" aria-labelledby={labelId}>
                <button
                  id={labelId}
                  type="button"
                  className={`sidebar-navigation-button sidebar-navigation-group-toggle${containsActive ? ' contains-active' : ''}`}
                  aria-label={group.label || details.label}
                  title={group.label || details.label}
                  aria-expanded={expanded}
                  aria-controls={sectionId}
                  onClick={() => toggleSection(group.id)}
                >
                  <Icon name={details.icon} />
                  <span className="nav-item-label">{group.label || details.label}</span>
                  <span className={`sidebar-navigation-chevron${expanded ? ' is-open' : ''}`} aria-hidden="true"><Icon name="collapse" size={16} /></span>
                </button>
                <div id={sectionId} className="sidebar-navigation-children" hidden={!expanded}>
                  {group.items.map(item => renderItem(item, true))}
                </div>
              </section>
            )
          }
          if (group.collapsible || !group.label) {
            return <div key={group.id} className={`sidebar-navigation-direct${group.collapsible ? ' sidebar-navigation-disclosure' : ''}`}>{group.items.map(item => renderItem(item))}</div>
          }
          return (
            <section key={group.id} className="sidebar-navigation-section" aria-labelledby={labelId}>
              <h2 id={labelId} className="sidebar-navigation-section-label">{group.label}</h2>
              {group.items.map(item => renderItem(item))}
            </section>
          )
        })}
      </div>
      {help && <div className="sidebar-navigation-help">{renderItem(help)}</div>}
    </nav>
  )
}

/**
 * Receives only modules already allowed by the current user's permissions.
 * Module IDs stay unchanged; section metadata controls presentation only.
 */
export default function SidebarNavigation({ items, activeId, onNavigate, userKey, compact = false, onExpand }) {
  const storageKey = `pignus-sidebar-groups:${encodeURIComponent(String(userKey || 'anonymous'))}`
  return <SidebarNavigationMenu key={storageKey} items={items} activeId={activeId} onNavigate={onNavigate} storageKey={storageKey} compact={compact} onExpand={onExpand} />
}

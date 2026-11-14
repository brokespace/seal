import type React from 'react'
import '../drag/project-header-drag'
import { isRepoHeaderActionTarget } from '../drag/project-header-drag-contract'
import { isProjectOrPinnedSectionGroupKey } from '../../../../../../shared/sidebar-list/sections/group-keys'

export function stopRepoHeaderKeyboardToggle(event: React.KeyboardEvent<HTMLElement>): void {
  if (event.key === 'Enter' || event.key === ' ') {
    event.stopPropagation()
  }
}

export function stopNestedWorktreeCardBubble(event: React.SyntheticEvent<HTMLElement>): void {
  event.stopPropagation()
}

export function handleRepoHeaderActionPointerDown(event: React.PointerEvent<HTMLElement>): void {
  event.stopPropagation()
}

export function handleRepoHeaderCollapseAffordancePointerDown(
  event: React.PointerEvent<HTMLElement>
): void {
  event.stopPropagation()
}

export function stopRepoHeaderMenuEvent(event: React.SyntheticEvent<HTMLElement>): void {
  event.stopPropagation()
}

// A press that begins on an action and slides off it lands its click on the header itself.
let lastPressTarget: EventTarget | null = null
if (typeof document !== 'undefined') {
  document.addEventListener(
    'pointerdown',
    (event) => {
      lastPressTarget = event.target
    },
    true
  )
}

export function shouldIgnoreRepoHeaderToggle(event: React.SyntheticEvent<HTMLElement>): boolean {
  const pressTarget = event.type === 'click' ? lastPressTarget : null
  lastPressTarget = null
  return (
    isRepoHeaderActionTarget(event.target, event.currentTarget) ||
    isRepoHeaderActionTarget(pressTarget, event.currentTarget)
  )
}

// Alt/Option-click toggles all projects and Pinned together.
export function toggleSectionHeaderCollapse(
  event: React.MouseEvent | React.KeyboardEvent,
  collapseKey: string,
  ctx: { toggleGroupWithScrollAnchor: (key: string) => void; toggleAllProjects?: () => void }
): void {
  if (event.altKey && ctx.toggleAllProjects && isProjectOrPinnedSectionGroupKey(collapseKey)) {
    ctx.toggleAllProjects()
    return
  }
  ctx.toggleGroupWithScrollAnchor(collapseKey)
}

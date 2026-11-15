import React from 'react'
import { cn } from '@/lib/class-names'

// Hover actions overlay titles; touch keeps them in flow. Pointer/self-stretch prevent action gutters becoming drag handles.
export const PROJECT_HEADER_ACTIONS_CLASS_NAME = cn(
  'flex shrink-0 cursor-pointer items-center gap-0.5 self-stretch',
  'can-hover:absolute can-hover:right-1 can-hover:top-1/2 can-hover:z-10 can-hover:-translate-y-1/2',
  'can-hover:rounded-md can-hover:bg-worktree-sidebar can-hover:pl-1',
  'can-hover:pointer-events-none can-hover:opacity-0 can-hover:transition-opacity',
  'group-hover:pointer-events-auto group-hover:opacity-100',
  'has-[:focus-visible]:pointer-events-auto has-[:focus-visible]:opacity-100',
  'has-[button[aria-expanded=true]]:pointer-events-auto has-[button[aria-expanded=true]]:opacity-100'
)

/**
 * Title padding that keeps the sessions badge clear of the hover actions, which otherwise cover the
 * end of the title: two buttons left of a project's fold chevron, up to three on other headers.
 */
export function projectHeaderBadgeRoomClassName(beforeFold: boolean): string {
  return beforeFold
    ? 'can-hover:has-[[data-live-sessions-badge]]:pr-11'
    : 'can-hover:has-[[data-live-sessions-badge]]:pr-17'
}

export function ProjectHeaderActions({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return (
    <div
      data-repo-header-actions=""
      className={cn(PROJECT_HEADER_ACTIONS_CLASS_NAME, className)}
      {...props}
    />
  )
}

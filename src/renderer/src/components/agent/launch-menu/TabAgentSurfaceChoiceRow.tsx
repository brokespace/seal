import React, { useRef } from 'react'
import {
  AgentSurfaceLaunchButton,
  moveAgentRowActionFocus
} from '@/components/agent/AgentSurfaceLaunchButton'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import type { NewTabAgentMenuRow } from '../../../../../shared/agent-launch/picker/agent-launch-picker-rows'
import { terminalPendingReason } from './new-tab-agent-menu-model'
import { installServerOfferLabel, rowTitle } from './agent-menu-row-presentation'
import { useTranslate } from '@/i18n/use-translate'

// Why: the row starts its own surface; its trailing button (ArrowRight or Tab, then Enter) opens the other.
export function TabAgentSurfaceChoiceRow({
  row,
  other,
  otherReason,
  label,
  disabled,
  terminalPending,
  runLaunch,
  children
}: {
  row: NewTabAgentMenuRow
  other: NewTabAgentMenuRow
  /** Why the other surface cannot start here, beyond a host that is still connecting. */
  otherReason?: string
  label: string
  disabled: boolean
  terminalPending?: boolean
  runLaunch: (row: NewTabAgentMenuRow) => boolean | void | Promise<boolean>
  children: React.ReactNode
}): React.JSX.Element {
  const t = useTranslate()
  const otherButton = useRef<HTMLButtonElement>(null)
  const releaseTarget = useRef<{ event: PointerEvent; target: EventTarget } | null>(null)
  const title = rowTitle(row, label, t)
  const reason = otherReason ?? terminalPendingReason(terminalPending, other, t)
  return (
    <DropdownMenuItem
      variant="launch"
      disabled={disabled}
      title={title}
      aria-label={title}
      onPointerUp={(event) => {
        // Radix synchronously clicks the row on drag release, discarding the release target.
        const release = { event: event.nativeEvent, target: event.target }
        releaseTarget.current = release
        queueMicrotask(() => {
          if (releaseTarget.current === release) {
            releaseTarget.current = null
          }
        })
      }}
      onClick={(event) => {
        const release = releaseTarget.current
        releaseTarget.current = null
        if (disabled) {
          return
        }
        const target =
          event.target === event.currentTarget && release && release.event.eventPhase !== Event.NONE
            ? release.target
            : event.target
        const onOther = target instanceof Node && !!otherButton.current?.contains(target)
        if ((onOther && reason) || runLaunch(onOther ? other : row) === false) {
          event.preventDefault()
        }
      }}
      onKeyDown={(event) => {
        moveAgentRowActionFocus(event)
        if (event.key === 'ArrowRight') {
          event.preventDefault()
          otherButton.current?.focus()
        }
      }}
    >
      <span
        role="button"
        aria-disabled={!!terminalPendingReason(terminalPending, row, t) || undefined}
        aria-description={terminalPendingReason(terminalPending, row, t)}
        className="contents"
      >
        {children}
      </span>
      <AgentSurfaceLaunchButton
        ref={otherButton}
        surface={other.kind === 'cli' || other.kind === 'terminal' ? 'terminal' : 'chat'}
        title={
          other.kind === 'chat-unavailable' ? installServerOfferLabel(t) : rowTitle(other, label, t)
        }
        reason={reason}
      />
    </DropdownMenuItem>
  )
}

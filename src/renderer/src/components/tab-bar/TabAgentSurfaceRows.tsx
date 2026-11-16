import React from 'react'
import { AgentIcon } from '@/components/agent/icons/AgentIcon'
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut
} from '@/components/ui/dropdown-menu'
import { useOptionalShortcutLabel } from '@/hooks/useShortcutLabel'
import { useTranslate } from '@/i18n/use-translate'
import { getAgentCatalog } from '@/lib/agent-catalog/agent-catalog'
import { offerSealServerInstall } from '@/lib/agent-session/launch/routing/seal-server-install-offer'
import type { TuiAgent } from '../../../../shared/agent-launch/catalog/tui-agent'
import type { NewTabAgentMenuRow } from '../../../../shared/agent-launch/picker/agent-launch-picker-rows'
import { useAgentLaunchHostName } from './agent-launch-host-name'
import { terminalPendingReason } from './new-tab-agent-menu-model'
import { TabAgentSurfaceChoiceRow } from './TabAgentSurfaceChoiceRow'
import {
  chatUnavailableLabel,
  cliMissingReason,
  rowId,
  rowLabel,
  rowTitle
} from './tab-agent-row-presentation'

/** The same agent on the other surface: a chat's CLI, or a CLI row's chat or its install offer. */
export function otherSurfaceRow(
  row: Exclude<NewTabAgentMenuRow, { kind: 'chat-unavailable' }>,
  detectedIds: readonly TuiAgent[] | null
): { row: NewTabAgentMenuRow; cliMissing?: true } | null {
  const { agent, executionHostId } = row
  if (row.kind === 'chat') {
    return {
      row: { kind: 'cli', agent, executionHostId },
      // An unknown inventory offers the CLI; the launch reports a missing binary.
      ...(detectedIds && !detectedIds.includes(agent) ? { cliMissing: true as const } : {})
    }
  }
  if (row.kind !== 'cli') {
    return null
  }
  if (row.chat) {
    return {
      row: { kind: 'chat', agent, executionHostId, ...(row.viaCli ? { viaCli: true } : {}) }
    }
  }
  return row.needsServer
    ? { row: { kind: 'chat-unavailable', agent, reason: 'needs-server', executionHostId } }
    : null
}

/** The flat agent list: one row per agent and surface, each naming its other surface beside it. */
export function TabAgentSurfaceRows({
  rows,
  detectedIds,
  terminalPending,
  disabled,
  defaultAgent,
  runLaunch
}: {
  rows: readonly NewTabAgentMenuRow[]
  detectedIds: readonly TuiAgent[] | null
  terminalPending?: boolean
  disabled: boolean
  defaultAgent: TuiAgent | 'blank' | null | undefined
  runLaunch: (row: NewTabAgentMenuRow) => boolean | void | Promise<boolean>
}): React.JSX.Element {
  const t = useTranslate()
  const newAgentShortcut = useOptionalShortcutLabel('tab.newAgent')
  const hostName = useAgentLaunchHostName(rows[0]?.executionHostId)
  return (
    <>
      {rows.map((row, index) => {
        const { agent } = row
        const label = getAgentCatalog().find((entry) => entry.id === agent)?.label ?? agent
        // Chat rows come first; the rows that open a terminal start their own group.
        const startsCliGroup = row.kind === 'cli' && index > 0 && rows[index - 1]?.kind !== 'cli'
        if (row.kind === 'chat-unavailable') {
          if (row.reason === 'needs-server') {
            return (
              <DropdownMenuItem
                key={rowId(row)}
                variant="launch"
                disabled={disabled}
                data-agent-chat-install-offer
                onSelect={(event) => {
                  if (!offerSealServerInstall(row.executionHostId)) {
                    event.preventDefault()
                  }
                }}
              >
                <AgentIcon agent={agent} size={14} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{label}</span>
                  <span className="truncate text-xs font-normal text-muted-foreground">
                    {chatUnavailableLabel(row.reason, t)}
                  </span>
                </span>
              </DropdownMenuItem>
            )
          }
          return (
            <DropdownMenuItem key={rowId(row)} variant="launch" disabled>
              <AgentIcon agent={agent} size={14} />
              <span className="flex-1">{label}</span>
              <span className="font-normal text-muted-foreground">
                {chatUnavailableLabel(row.reason, t)}
              </span>
            </DropdownMenuItem>
          )
        }
        const showsDefaultAgentShortcut =
          newAgentShortcut !== null && defaultAgent !== 'blank' && agent === defaultAgent
        const pendingReason = terminalPendingReason(terminalPending, row, t)
        // One note per row: the wait, else why this agent's CLI is its only surface here.
        const note =
          pendingReason ??
          (row.kind === 'cli' && row.noChat ? chatUnavailableLabel(row.noChat, t) : undefined)
        const rowContent = (
          <>
            <AgentIcon agent={agent} size={14} />
            <span className="min-w-0 flex-1 truncate">{rowLabel(row, t)}</span>
            {note ? (
              <span className="min-w-0 shrink truncate text-xs text-muted-foreground">{note}</span>
            ) : null}
            {showsDefaultAgentShortcut ? (
              <DropdownMenuShortcut>{newAgentShortcut}</DropdownMenuShortcut>
            ) : null}
          </>
        )
        const other = otherSurfaceRow(row, detectedIds)
        return (
          <React.Fragment key={rowId(row)}>
            {startsCliGroup ? <DropdownMenuSeparator /> : null}
            {other ? (
              <TabAgentSurfaceChoiceRow
                row={row}
                other={other.row}
                otherReason={other.cliMissing ? cliMissingReason(label, hostName, t) : undefined}
                label={label}
                terminalPending={terminalPending}
                disabled={disabled}
                runLaunch={runLaunch}
              >
                {rowContent}
              </TabAgentSurfaceChoiceRow>
            ) : (
              <DropdownMenuItem
                variant="launch"
                disabled={disabled || !!pendingReason}
                aria-description={pendingReason}
                onSelect={(event) => {
                  if (runLaunch(row) === false) {
                    event.preventDefault()
                  }
                }}
                title={rowTitle(row, label, t)}
              >
                {rowContent}
              </DropdownMenuItem>
            )}
          </React.Fragment>
        )
      })}
    </>
  )
}

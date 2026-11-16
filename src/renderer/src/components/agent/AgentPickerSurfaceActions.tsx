import { useDropdownMenuClose } from '@/components/ui/dropdown-menu'
import { useTranslate } from '@/i18n/use-translate'
import { offerSealServerInstall } from '@/lib/agent-session/launch/routing/seal-server-install-offer'
import type { NewTabAgentMenuRow } from '../../../../shared/agent-launch/picker/agent-launch-picker-rows'
import type { AgentPickerEntry } from '../../../../shared/agent-launch/picker/agent-launch-picker'
import { useAgentLaunchHostName } from '../tab-bar/agent-launch-host-name'
import { terminalPendingLabel } from '../tab-bar/new-tab-agent-menu-model'
import {
  cliMissingReason,
  cliNeedsServerReason,
  installServerOfferLabel,
  rowTitle
} from '../tab-bar/tab-agent-row-presentation'
import {
  pickerActionSurfaces,
  pickerEntryRow,
  pickerSurfaceOpensTerminal
} from './agent-picker-launch-row'
import { AgentSurfaceLaunchButton } from './AgentSurfaceLaunchButton'

/** An agent row's surfaces as labelled actions, each launching exactly that surface. */
export function AgentPickerSurfaceActions({
  entry,
  disabled,
  terminalBlocked,
  runLaunch
}: {
  entry: AgentPickerEntry
  disabled?: boolean
  terminalBlocked?: boolean
  runLaunch: (row: NewTabAgentMenuRow) => boolean | void | Promise<boolean>
}): React.JSX.Element {
  const t = useTranslate()
  const closeMenu = useDropdownMenuClose()
  const executionHostId = entry.rows[0]?.executionHostId ?? entry.draftTarget?.executionHostId
  const hostName = useAgentLaunchHostName(executionHostId)
  return (
    <span className="flex shrink-0 items-center pr-1">
      {pickerActionSurfaces(entry).map((surface) => {
        const offersInstall = surface === 'chat' && entry.chatAction === 'install-server'
        const row = pickerEntryRow(entry, surface)
        const reason =
          surface === 'terminal' && entry.terminalMissing
            ? entry.terminalMissing === 'needs-server'
              ? cliNeedsServerReason(t)
              : cliMissingReason(entry.label, hostName, t)
            : terminalBlocked && !offersInstall && pickerSurfaceOpensTerminal(entry, surface)
              ? terminalPendingLabel(t)
              : undefined
        return (
          <AgentSurfaceLaunchButton
            key={surface}
            surface={surface}
            // The install offer names where it leads: no chat opens until the server is there.
            title={offersInstall ? installServerOfferLabel(t) : rowTitle(row, entry.label, t)}
            reason={reason}
            disabled={disabled}
            data-agent-chat-install-offer={offersInstall || undefined}
            onClick={(event) => {
              // Stopped so the row does not also launch its default surface.
              event.stopPropagation()
              if (offersInstall) {
                offerSealServerInstall(executionHostId)
                closeMenu()
              } else if (runLaunch(row) !== false) {
                closeMenu()
              }
            }}
          />
        )
      })}
    </span>
  )
}

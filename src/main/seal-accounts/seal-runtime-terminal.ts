import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { setSealSessionTerminal, type SealAgentStatusRow } from './seal-session-terminal'

/** Lets Seal steer this host's panes: find a session's pane, stop its agent, type a resume. */
export function bindSealSessionTerminal(
  runtime: Pick<
    OrcaRuntimeService,
    'getTerminalHandleForPaneKey' | 'sendTerminal' | 'isTerminalRunningAgent'
  >,
  statusRows: () => readonly SealAgentStatusRow[]
): void {
  setSealSessionTerminal({
    statusRows,
    handleForPane: (paneKey) => runtime.getTerminalHandleForPaneKey(paneKey),
    send: (handle, action) => runtime.sendTerminal(handle, action, { inputKind: 'driving' }),
    isAgentRunning: (handle) => runtime.isTerminalRunningAgent(handle)
  })
}

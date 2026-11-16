import type { NewTabAgentMenuRow } from '../../../../shared/agent-launch/picker/agent-launch-picker-rows'
import type {
  AgentPickerEntry,
  AgentPickerSurface
} from '../../../../shared/agent-launch/picker/agent-launch-picker'

/** The row a picker entry launches on one surface, for a setup the menu model did not list. */
export function pickerLaunchRow(
  entry: AgentPickerEntry,
  surface: AgentPickerSurface
): NewTabAgentMenuRow {
  const { agent } = entry
  const executionHostId = entry.rows[0]?.executionHostId
  return surface === 'chat'
    ? {
        agent,
        kind: 'chat',
        executionHostId,
        ...(entry.chatAction === 'via-cli' ? { viaCli: true as const } : {})
      }
    : { agent, kind: 'cli', executionHostId }
}

/** The menu model's own row for that surface when it listed one, so its launch facts carry over. */
export function pickerEntryRow(
  entry: AgentPickerEntry,
  surface: AgentPickerSurface
): NewTabAgentMenuRow {
  return (
    entry.rows.find((row) =>
      surface === 'chat' ? row.kind === 'chat' : row.kind === 'terminal' || row.kind === 'cli'
    ) ?? pickerLaunchRow(entry, surface)
  )
}

/** Whether launching that surface starts a terminal: the CLI, or a chat that is the CLI in chat view. */
export function pickerSurfaceOpensTerminal(
  entry: AgentPickerEntry,
  surface: AgentPickerSurface
): boolean {
  return surface === 'terminal' || entry.chatAction === 'via-cli'
}

/** The surfaces an agent row names as actions, default first; a host that runs no chats names none. */
export function pickerActionSurfaces(entry: AgentPickerEntry): AgentPickerSurface[] {
  if (entry.rows.some((row) => row.kind === 'terminal')) {
    return []
  }
  const other: AgentPickerSurface = entry.defaultSurface === 'chat' ? 'terminal' : 'chat'
  return [entry.defaultSurface, other].filter((surface) =>
    surface === 'chat'
      ? entry.surfaces.includes('chat') || entry.chatAction === 'install-server'
      : entry.surfaces.includes('terminal') || entry.terminalMissing === true
  )
}

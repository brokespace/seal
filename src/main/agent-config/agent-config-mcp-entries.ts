import { convertMcpEntry, rawMcpEntry } from '../../shared/agent-config/agent-config-mcp-servers'
import type {
  AgentConfigScope,
  AgentConfigTarget
} from '../../shared/agent-config/agent-config-types'
import type { MachineConnection } from '../machines/connection/machine-connection'
import { editFile, requireMcpFile, resolveOnMachine } from './agent-config-settings-ops'

/**
 * Adds and removes whole servers, given as Claude Code's `.mcp.json` spells them, in one agent's
 * file. A server already there under an added name is left alone and reported as skipped.
 */
export async function writeMcpEntries(
  connection: MachineConnection,
  args: {
    target: AgentConfigTarget
    scope: AgentConfigScope
    add: Record<string, Record<string, unknown>>
    remove: string[]
  }
): Promise<{ path: string; written: string[]; skipped: string[] }> {
  const resolved = await resolveOnMachine(connection, args.target)
  const { location, format } = requireMcpFile(resolved, args.scope)
  const written: string[] = []
  const skipped: string[] = []
  const converted = Object.entries(args.add).map(
    ([name, entry]) => [name, convertMcpEntry(entry, 'claude', location.codec)] as const
  )
  await editFile(
    connection,
    location.sourcePath,
    format,
    (config) => [
      ...args.remove
        .filter((name) => rawMcpEntry(config, location, name))
        .map((name) => ({ path: [...location.serversPath, name], remove: true as const })),
      ...converted.flatMap(([name, entry]) => {
        if (rawMcpEntry(config, location, name)) {
          skipped.push(name)
          return []
        }
        written.push(name)
        return [{ path: [...location.serversPath, name], value: entry }]
      })
    ],
    { private: args.scope !== 'project' }
  )
  return { path: location.sourcePath, written, skipped }
}

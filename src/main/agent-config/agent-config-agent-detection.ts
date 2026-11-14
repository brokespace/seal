import { AGENT_CONFIG_LAYOUTS } from '../../shared/agent-config/agent-config-catalog'
import type { AgentConfigAgentPresence } from '../../shared/agent-config/agent-config-types'
import type { MachineConnection } from '../machines/connection/machine-connection'
import { scanMachineFiles } from '../machines/scan/machine-file-scan'
import { scanRunner } from './agent-config-file-io'
import { joinRelative } from './agent-config-locations'

/** Which agents are installed or have configuration on a machine, in one round trip. */
export async function detectAgentConfigAgents(
  connection: MachineConnection,
  projectPath?: string
): Promise<AgentConfigAgentPresence[]> {
  const project = projectPath?.replace(/[\\/]+$/, '')
  const scan = await scanMachineFiles(await scanRunner(connection), {
    commands: AGENT_CONFIG_LAYOUTS.map((layout) => layout.command),
    dirs: AGENT_CONFIG_LAYOUTS.map((layout) => ({
      tag: layout.id,
      path: project ? joinRelative(project, layout.project.dir) : `~/${layout.user.dir}`
    })),
    files: project
      ? AGENT_CONFIG_LAYOUTS.flatMap((layout) =>
          [...layout.project.instructions, ...layout.project.files.map((file) => file.path)].map(
            (relative) => ({ tag: layout.id, path: joinRelative(project, relative) })
          )
        )
      : [],
    headBytes: 0
  })
  const configured = new Set([
    ...scan.dirs.map((dir) => dir.tag),
    ...scan.records.map((r) => r.tag)
  ])
  return AGENT_CONFIG_LAYOUTS.map((layout) => ({
    agent: layout.id,
    label: layout.label,
    installed: scan.commands.includes(layout.command),
    configured: configured.has(layout.id)
  }))
}

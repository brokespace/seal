import { parseJsonObject } from '../../shared/agent-config/agent-config-json-edit'
import { buildAgentPluginCatalog } from '../../shared/agent-plugins/agent-plugin-catalog'
import type {
  AgentPluginCatalog,
  AgentPluginHarness
} from '../../shared/agent-plugins/agent-plugin-types'
import type { MachineConnection } from '../machines/connection/machine-connection'
import { joinRelative } from '../agent-config/agent-config-locations'
import { runAgentCli } from '../agent-config/agent-config-plugin-commands'

const LIST_TIMEOUT_MS = 90_000
const MAX_CACHE_BYTES = 16 * 1024 * 1024

const LIST_ARGS: Record<AgentPluginHarness, string[]> = {
  claude: ['plugin', 'list', '--available', '--json'],
  codex: ['plugin', 'list', '--json', '--available']
}

/** The JSON object in a CLI's output; Codex prints warnings around it on stderr only. */
function jsonOutput(stdout: string): unknown {
  const start = stdout.indexOf('{')
  const parsed = start !== -1 ? parseJsonObject(stdout.slice(start)) : null
  return parsed?.ok ? parsed.value : null
}

async function list(
  connection: MachineConnection,
  harness: AgentPluginHarness
): Promise<{ value: unknown; available: boolean; error?: string }> {
  const run = await runAgentCli(connection, harness, LIST_ARGS[harness], {
    timeoutMs: LIST_TIMEOUT_MS
  }).catch((error: unknown) => ({
    ok: false,
    stdout: '',
    output: error instanceof Error ? error.message : String(error),
    command: ''
  }))
  const value = run.ok ? jsonOutput(run.stdout) : null
  if (value === null) {
    return { value: null, available: false, error: run.output || 'No plugin list came back' }
  }
  return { value, available: true }
}

/** Every plugin each agent's own CLI offers on the machine, merged by name. */
export async function readAgentPluginCatalog(
  connection: MachineConnection
): Promise<AgentPluginCatalog> {
  const home = await connection.files.homeDir()
  const [claude, codex, cache] = await Promise.all([
    list(connection, 'claude'),
    list(connection, 'codex'),
    connection.files
      .readFile(joinRelative(home, '.claude/plugins/plugin-catalog-cache.json'), MAX_CACHE_BYTES)
      .then((read) => parseJsonObject(read.data.toString('utf8')))
      .catch(() => null)
  ])
  return {
    entries: buildAgentPluginCatalog({
      claude: claude.value,
      codex: codex.value,
      claudeCatalogCache: cache?.ok ? cache.value : null
    }),
    harnesses: [
      {
        harness: 'claude',
        available: claude.available,
        ...(claude.error ? { error: claude.error } : {})
      },
      {
        harness: 'codex',
        available: codex.available,
        ...(codex.error ? { error: codex.error } : {})
      }
    ]
  }
}

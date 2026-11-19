import {
  AGENT_PLUGIN_LEDGER_PATH,
  parseAgentPluginLedger
} from '../../shared/agent-plugins/agent-plugin-ledger'
import type { AgentPluginLedger } from '../../shared/agent-plugins/agent-plugin-types'
import { parseJsonObject } from '../../shared/agent-config/agent-config-json-edit'
import { machinePathDirname } from '../../shared/machines/machine-paths'
import type { MachineId } from '../../shared/machines/machine-types'
import { quotePosixShell } from '../../shared/shell/launch/shell-argument-quoting'
import type { MachineConnection } from '../machines/connection/machine-connection'
import { joinRelative } from '../agent-config/agent-config-locations'

const MAX_LEDGER_BYTES = 8 * 1024 * 1024
const EXEC_TIMEOUT_MS = 30_000

export function agentPluginLedgerPath(home: string): string {
  return joinRelative(home, AGENT_PLUGIN_LEDGER_PATH)
}

/** A missing ledger is an empty one; an unreadable one is an error, so nothing is overwritten blind. */
export async function readAgentPluginLedger(
  connection: MachineConnection,
  home: string
): Promise<AgentPluginLedger> {
  const path = agentPluginLedgerPath(home)
  const stat = await connection.files.stat(path).catch(() => null)
  if (!stat) {
    return { version: 1, plugins: [] }
  }
  const read = await connection.files.readFile(path, MAX_LEDGER_BYTES)
  const parsed = parseJsonObject(read.data.toString('utf8'))
  if (!parsed.ok) {
    throw new Error(`${path} is not valid JSON (${parsed.error}); fix or remove it first`)
  }
  return parseAgentPluginLedger(parsed.value)
}

async function writeLedger(
  connection: MachineConnection,
  home: string,
  ledger: AgentPluginLedger
): Promise<void> {
  const path = agentPluginLedgerPath(home)
  const dir = machinePathDirname(path)
  if (dir) {
    await connection.files.createDir(dir)
  }
  await connection.files.writeFile(path, Buffer.from(`${JSON.stringify(ledger, null, 2)}\n`))
  // MCP entries can carry tokens a plugin's author put inline.
  if ((await connection.dialect()) === 'posix') {
    await connection
      .exec(`chmod 600 ${quotePosixShell(path)}`, { timeoutMs: EXEC_TIMEOUT_MS })
      .catch(() => {})
  }
}

const queues = new Map<MachineId, Promise<unknown>>()

/** One change at a time per machine, so two installs cannot drop each other's record. */
export function updateAgentPluginLedger<T>(
  connection: MachineConnection,
  home: string,
  change: (ledger: AgentPluginLedger) => Promise<{ ledger: AgentPluginLedger; result: T }>
): Promise<T> {
  const previous = queues.get(connection.machineId) ?? Promise.resolve()
  const next = previous
    .catch(() => {})
    .then(async () => {
      const { ledger, result } = await change(await readAgentPluginLedger(connection, home))
      await writeLedger(connection, home, ledger)
      return result
    })
  queues.set(connection.machineId, next)
  return next
}

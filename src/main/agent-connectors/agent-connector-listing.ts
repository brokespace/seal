import type {
  AgentConnectorAccount,
  AgentConnectorAgent,
  AgentConnectorsSnapshot
} from '../../shared/agent-connectors/agent-connector-types'
import type { MachineId } from '../../shared/machines/machine-types'
import type {
  MachineConnection,
  MachineShellDialect
} from '../machines/connection/machine-connection'
import { quoteForMachineShell } from '../machines/work/machine-worktrees'
import { connectorAccountName, readMachineSealAccounts } from './agent-connector-account-labels'
import { lastCliMessage, parseClaudeMcpList, parseCodexMcpList } from './agent-connector-cli-output'
import { findConnectorDuplicates } from './agent-connector-duplicates'
import {
  discoverConnectorHomes,
  readClaudeHomeFacts,
  type ConnectorHome,
  type ConnectorHomeFacts
} from './agent-connector-homes'

// `claude mcp list` connects to every server; a slow one holds the whole list.
const LIST_TIMEOUT_MS = 120_000
const FRESH_MS = 10 * 60_000
// Each list starts every stdio server once; keep a few at a time.
const PARALLEL_HOMES = 3

type MachineConnectors = { snapshot: AgentConnectorsSnapshot; homes: Map<string, ConnectorHome> }

const cache = new Map<MachineId, MachineConnectors>()
const inflight = new Map<string, Promise<AgentConnectorsSnapshot>>()

const CONFIG_ENV: Record<AgentConnectorAgent, string> = {
  claude: 'CLAUDE_CONFIG_DIR',
  codex: 'CODEX_HOME'
}

/** Runs `<agent> <args>` with the home's config dir; the PTY sign-in shares this. */
export function agentCommandForHome(
  home: ConnectorHome,
  args: readonly string[],
  dialect: MachineShellDialect
): string {
  const quoted = args.map((arg) => quoteForMachineShell(arg, dialect)).join(' ')
  const env = CONFIG_ENV[home.agent]
  if (dialect === 'powershell') {
    const set = home.configDir
      ? `$env:${env}=${quoteForMachineShell(home.configDir, dialect)}; `
      : ''
    return `${set}& ${home.agent} ${quoted}; exit $LASTEXITCODE`
  }
  // `env` works from sh, bash, zsh and fish alike.
  const set = home.configDir ? `env ${env}=${quoteForMachineShell(home.configDir, dialect)} ` : ''
  return `${set}${home.agent} ${quoted}`
}

async function listHome(
  connection: MachineConnection,
  home: ConnectorHome,
  userHome: string,
  candidates: Awaited<ReturnType<typeof readMachineSealAccounts>>
): Promise<AgentConnectorAccount> {
  const dialect = await connection.dialect()
  const facts: ConnectorHomeFacts =
    home.agent === 'claude'
      ? await readClaudeHomeFacts(connection, home, userHome)
      : { email: null, userServers: new Set(), claudeAiConnectorsDisabled: false }
  const args = home.agent === 'claude' ? ['mcp', 'list'] : ['mcp', 'list', '--json']
  const command = agentCommandForHome(home, args, dialect)
  const result = await connection.exec(
    dialect === 'powershell' ? command : `${command} </dev/null`,
    { timeoutMs: LIST_TIMEOUT_MS }
  )
  const output = `${result.stdout}\n${result.stderr}`
  const connectors =
    home.agent === 'claude'
      ? parseClaudeMcpList(output, facts.userServers)
      : parseCodexMcpList(result.stdout)
  const failed = result.timedOut || (result.exitCode !== 0 && connectors.length === 0)
  return {
    id: home.accountId,
    agent: home.agent,
    ...connectorAccountName(home, candidates, facts.email),
    isDefault: home.configDir === null,
    connectors,
    duplicates: findConnectorDuplicates(connectors),
    claudeAiConnectorsDisabled: facts.claudeAiConnectorsDisabled,
    error: failed
      ? result.timedOut
        ? `The connector check did not finish in ${LIST_TIMEOUT_MS / 1000} seconds`
        : (lastCliMessage(output) ?? `${home.agent} exited with ${result.exitCode}`)
      : null,
    checkedAt: Date.now()
  }
}

async function mapLimited<T, R>(items: readonly T[], run: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = Array.from({ length: items.length })
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++
      results[index] = await run(items[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(PARALLEL_HOMES, items.length) }, worker))
  return results
}

async function check(
  connection: MachineConnection,
  dataRoot: string | null,
  accountId: string | null
): Promise<AgentConnectorsSnapshot> {
  const machineId = connection.machineId
  const cached = cache.get(machineId)
  const homes =
    accountId && cached
      ? cached.homes
      : new Map(
          (await discoverConnectorHomes(connection, dataRoot)).map((home) => [home.accountId, home])
        )
  const targets = accountId
    ? [homes.get(accountId)].filter((home) => home !== undefined)
    : [...homes.values()]
  const [userHome, candidates] = await Promise.all([
    connection.files.homeDir(),
    readMachineSealAccounts(machineId)
  ])
  const checked = await mapLimited(targets, async (home) =>
    listHome(connection, home, userHome, candidates).catch(
      (error: unknown): AgentConnectorAccount => ({
        id: home.accountId,
        agent: home.agent,
        ...connectorAccountName(home, candidates, null),
        isDefault: home.configDir === null,
        connectors: [],
        duplicates: [],
        claudeAiConnectorsDisabled: false,
        error: error instanceof Error ? error.message : String(error),
        checkedAt: Date.now()
      })
    )
  )
  const fresh = new Map(checked.map((account) => [account.id, account]))
  const accounts = accountId
    ? (cached?.snapshot.accounts ?? []).map((account) => fresh.get(account.id) ?? account)
    : checked
  const snapshot = { machineId, accounts, checkedAt: Date.now() }
  cache.set(machineId, { snapshot, homes })
  return snapshot
}

/** Served from memory for a while; `force` or `accountId` re-checks (the CLI health-checks every server). */
export function listAgentConnectors(
  connection: MachineConnection,
  options: { dataRoot: string | null; force: boolean; accountId: string | null }
): Promise<AgentConnectorsSnapshot> {
  const cached = cache.get(connection.machineId)
  if (
    cached &&
    !options.force &&
    !options.accountId &&
    Date.now() - cached.snapshot.checkedAt < FRESH_MS
  ) {
    return Promise.resolve(cached.snapshot)
  }
  const key = `${connection.machineId}\0${options.accountId ?? ''}`
  const running = inflight.get(key) ?? inflight.get(`${connection.machineId}\0`)
  if (running) {
    return running
  }
  const started = check(connection, options.dataRoot, options.accountId).finally(() =>
    inflight.delete(key)
  )
  inflight.set(key, started)
  return started
}

/** The config dir behind an account id from the last list of that machine. */
export function connectorHomeFor(machineId: MachineId, accountId: string): ConnectorHome | null {
  return cache.get(machineId)?.homes.get(accountId) ?? null
}

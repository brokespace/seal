import type { AgentConnectorAgent } from '../../shared/agent-connectors/agent-connector-types'
import { parseJsonObject } from '../../shared/agent-config/agent-config-json-edit'
import { isPlainObject } from '../../shared/agent-config/agent-config-values'
import {
  joinMachinePath,
  machinePathBasename,
  machinePathDirname
} from '../../shared/machines/machine-paths'
import type { MachineConnection } from '../machines/connection/machine-connection'
import { quoteForMachineShell } from '../machines/work/machine-worktrees'

const DISCOVER_TIMEOUT_MS = 20_000
// Big enough for a heavy user's `.claude.json`; past it, only labels and kinds are lost.
const MAX_STATE_BYTES = 16 * 1024 * 1024

/** A config dir an agent launches with on the machine. */
export type ConnectorHome = {
  accountId: string
  agent: AgentConnectorAgent
  /** Null is the agent's own default (`~/.claude`, `~/.codex`): no env override. */
  configDir: string | null
  /** The Seal account id the folder is named after; null for the default. */
  profileId: string | null
}

export type ConnectorHomeFacts = {
  email: string | null
  userServers: Set<string>
  claudeAiConnectorsDisabled: boolean
}

function posixDiscovery(dataRoot: string | null): string {
  const roots = [
    ...(dataRoot ? [quoteForMachineShell(dataRoot, 'posix')] : []),
    '"${XDG_CONFIG_HOME:-$HOME/.config}/Seal"',
    '"$HOME/Library/Application Support/Seal"'
  ]
  const each = (glob: string, agent: string): string =>
    `for d in ${glob}; do [ -d "$d" ] && printf '${agent}\\t%s\\n' "$d"; done`
  return [
    'for a in claude codex; do command -v "$a" >/dev/null 2>&1 && printf \'agent\\t%s\\n\' "$a"; done',
    `for root in ${roots.join(' ')}; do`,
    `  ${each('"$root"/claude-profiles/*/home', 'claude')}`,
    `  ${each('"$root"/codex-accounts/*/home', 'codex')}`,
    'done',
    each('"$HOME"/.local/share/orca/codex-accounts/*/home', 'codex')
  ].join('\n')
}

function powerShellDiscovery(dataRoot: string | null): string {
  const roots = [
    ...(dataRoot ? [quoteForMachineShell(dataRoot, 'powershell')] : []),
    "(Join-Path $env:APPDATA 'Seal')"
  ]
  return [
    "foreach ($a in @('claude','codex')) { if (Get-Command $a -ErrorAction SilentlyContinue) { \"agent`t$a\" } }",
    `foreach ($root in @(${roots.join(', ')})) {`,
    "  foreach ($pair in @(@('claude','claude-profiles'), @('codex','codex-accounts'))) {",
    '    $dir = Join-Path $root $pair[1]',
    '    if (Test-Path -LiteralPath $dir) {',
    '      Get-ChildItem -LiteralPath $dir -Directory | ForEach-Object {',
    "        $h = Join-Path $_.FullName 'home'",
    '        if (Test-Path -LiteralPath $h -PathType Container) { "$($pair[0])`t$h" }',
    '      }',
    '    }',
    '  }',
    '}'
  ].join('\n')
}

/** Every config dir Seal launches agents with on this machine, plus each agent's default. */
export async function discoverConnectorHomes(
  connection: MachineConnection,
  /** This desktop's own data folder when the machine is this computer. */
  dataRoot: string | null
): Promise<ConnectorHome[]> {
  const dialect = await connection.dialect()
  const result = await connection.exec(
    dialect === 'powershell' ? powerShellDiscovery(dataRoot) : posixDiscovery(dataRoot),
    { timeoutMs: DISCOVER_TIMEOUT_MS }
  )
  const installed = new Set<string>()
  const seen = new Set<string>()
  const homes: ConnectorHome[] = []
  for (const line of result.stdout.split(/\r?\n/)) {
    const [kind, path] = line.split('\t')
    if (kind === 'agent' && path) {
      installed.add(path.trim())
      continue
    }
    if ((kind !== 'claude' && kind !== 'codex') || !path || seen.has(path.trim())) {
      continue
    }
    const configDir = path.trim()
    seen.add(configDir)
    const parent = machinePathDirname(configDir)
    const profileId = parent ? machinePathBasename(parent) : null
    if (profileId) {
      homes.push({ accountId: `${kind}:${profileId}`, agent: kind, configDir, profileId })
    }
  }
  const defaults: ConnectorHome[] = (['claude', 'codex'] as const)
    .filter((agent) => installed.has(agent))
    .map((agent) => ({ accountId: `${agent}:default`, agent, configDir: null, profileId: null }))
  return [...defaults, ...homes.filter((home) => installed.has(home.agent))]
}

async function readJson(
  connection: MachineConnection,
  path: string
): Promise<Record<string, unknown> | null> {
  const read = await connection.files.readFile(path, MAX_STATE_BYTES).catch(() => null)
  if (!read || read.size > read.data.length) {
    return null
  }
  const parsed = parseJsonObject(read.data.toString('utf8'))
  return parsed.ok ? parsed.value : null
}

/** What the Claude folder says about its login, user-scope servers and claude.ai connectors. */
export async function readClaudeHomeFacts(
  connection: MachineConnection,
  home: ConnectorHome,
  userHome: string
): Promise<ConnectorHomeFacts> {
  const configDir = home.configDir ?? joinMachinePath(userHome, '.claude')
  const [state, settings] = await Promise.all([
    readJson(connection, joinMachinePath(home.configDir ?? userHome, '.claude.json')),
    readJson(connection, joinMachinePath(configDir, 'settings.json'))
  ])
  const account = isPlainObject(state?.oauthAccount) ? state.oauthAccount : null
  return {
    email: typeof account?.emailAddress === 'string' ? account.emailAddress : null,
    userServers: new Set(isPlainObject(state?.mcpServers) ? Object.keys(state.mcpServers) : []),
    claudeAiConnectorsDisabled: settings?.disableClaudeAiConnectors === true
  }
}

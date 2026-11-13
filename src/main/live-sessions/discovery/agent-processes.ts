import type { LiveSessionProvider } from '../../../shared/live-sessions/live-session-types'
import {
  AGENT_ONE_SHOT_FLAGS,
  AGENT_ONE_SHOT_SUBCOMMANDS,
  AGENT_TOOL_SUBCOMMANDS
} from '../../../shared/live-sessions/agent-subcommands'
import type { DiscoveredProcess } from './discovery-output'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const NOT_A_SESSION: Record<LiveSessionProvider, ReadonlySet<string>> = {
  claude: new Set([...AGENT_TOOL_SUBCOMMANDS.claude, ...AGENT_ONE_SHOT_SUBCOMMANDS.claude]),
  codex: new Set([...AGENT_TOOL_SUBCOMMANDS.codex, ...AGENT_ONE_SHOT_SUBCOMMANDS.codex])
}

// Another program drives these through pipes (Agent SDK hosts such as Seal's Home chat).
const HEADLESS_FLAGS: Record<LiveSessionProvider, ReadonlySet<string>> = {
  claude: new Set([
    ...AGENT_ONE_SHOT_FLAGS.claude,
    '--input-format',
    '--output-format',
    '--sdk-url'
  ]),
  codex: new Set(AGENT_ONE_SHOT_FLAGS.codex)
}
const TOOL = /^(claude|codex)(\.[cm]?js)?$/

export function processProvider(args: string): LiveSessionProvider | null {
  const [command = '', script = '', ...rest] = args.split(/\s+/)
  const name = (value: string) => value.split('/').pop() ?? ''
  // Claude's native installer names its binary for the version: `~/.local/share/claude/versions/2.1.3`.
  const direct = /\/claude\/versions\/[\d.]+$/.test(command)
    ? 'claude'
    : TOOL.exec(name(command))?.[1]
  let provider: LiveSessionProvider | null = null
  let subcommand = ''
  if (direct === 'claude' || direct === 'codex') {
    provider = direct
    subcommand = script
  } else if (name(command) === 'node') {
    const named = TOOL.exec(name(script))?.[1]
    if (script.endsWith('claude-code/cli.js') || named === 'claude') {
      provider = 'claude'
    } else if (/@openai\/codex\/bin\//.test(script) || named === 'codex') {
      provider = 'codex'
    }
    subcommand = rest[0] ?? ''
  }
  if (!provider || NOT_A_SESSION[provider].has(subcommand)) {
    return null
  }
  return args.split(/\s+/).some((word) => HEADLESS_FLAGS[provider].has(word.split('=')[0]))
    ? null
    : provider
}

/** The binary a session runs, when its command line names it by absolute path. */
export function processBinary(args: string, provider: LiveSessionProvider): string | null {
  const command = args.split(/\s+/)[0] ?? ''
  return command.startsWith('/') && command.split('/').pop() === provider ? command : null
}

/** `$CODEX_HOME`, from where a rollout lives: `<home>/sessions/YYYY/MM/DD/rollout-*.jsonl`. */
export function codexHomeOf(transcriptPath: string | null): string | null {
  const at = transcriptPath?.lastIndexOf('/sessions/') ?? -1
  return at > 0 ? transcriptPath!.slice(0, at) : null
}

/** The session a command line names: `--resume <id>`, `--session-id <id>`, `codex resume <id>`. */
export function sessionIdFromArgs(args: string): string | null {
  const words = args.split(/\s+/)
  for (let i = 0; i < words.length - 1; i++) {
    const flag = words[i]
    if (
      (flag === '--resume' || flag === '-r' || flag === '--session-id' || flag === 'resume') &&
      UUID.test(words[i + 1])
    ) {
      return words[i + 1]
    }
  }
  return null
}

/** Only the outermost agent process per session: npm's codex wrapper spawns the native binary. */
export function agentProcesses(
  processes: DiscoveredProcess[]
): (DiscoveredProcess & { provider: LiveSessionProvider })[] {
  const agents = processes.flatMap((p) => {
    const provider = processProvider(p.args)
    return provider ? [{ ...p, provider }] : []
  })
  const byPid = new Map(agents.map((p) => [p.pid, p]))
  return agents.filter((p) => byPid.get(p.ppid)?.provider !== p.provider)
}

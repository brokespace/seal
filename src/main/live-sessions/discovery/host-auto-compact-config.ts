import {
  autoCompactAtTokens,
  parseClaudeAutoCompactSettings,
  parseCodexAutoCompactSettings,
  type AgentAutoCompactSettings
} from '../../../shared/agent-session/agent-auto-compact-settings'
import type { LiveSessionProvider } from '../../../shared/live-sessions/live-session-types'
import { isContextUsageMeasured } from '../../../shared/native-chat/native-chat-context-usage-state'
import type { NativeChatContextUsageSummary } from '../../../shared/native-chat/native-chat-context-usage-summary'
import { quotePosixShell } from '../../../shared/shell/launch/shell-argument-quoting'

/** Claude config dirs (holding `projects/`) and Codex homes (holding `sessions/`). */
export type AgentConfigRoots = { claude: readonly string[]; codex: readonly string[] }

/** A config root the host was asked about; null text is settings that never mention compaction. */
export type DiscoveredAgentConfig = {
  provider: LiveSessionProvider
  root: string
  text: string | null
  /** Claude's global config turned auto-compact off. */
  autoCompactOff: boolean
}

/**
 * The discovery script's part: each config root's settings, sent only when they mention
 * compaction, so a file with nothing to say about it stays on its host. Of Claude's global
 * config only the flag that turns auto-compact off leaves it. Needs the script's `b64` and roots.
 */
export function autoCompactConfigSection(roots: AgentConfigRoots): string {
  return `compactcfg() {
  [ -n "$2" ] && [ -d "$2" ] || return 0
  printf '@@COMPACTCFG %s %s ' "$1" "$2"
  [ -f "$2/$3" ] && grep -qi compact "$2/$3" && head -c 65536 "$2/$3" | b64
  echo
  [ "$1" = claude ] || return 0
  g="$2/.claude.json"; [ "$2" = "$HOME/.claude" ] && g="$HOME/.claude.json"
  grep -q '"autoCompactEnabled"[[:space:]]*:[[:space:]]*false' "$g" 2>/dev/null && echo "@@COMPACTOFF $2"
  return 0
}
printf '%s\\n%s\\n' "$CLAUDE_ROOTS" ${quotePosixShell(roots.claude.join('\n'))} | sort -u | while IFS= read -r r; do compactcfg claude "$r" settings.json; done
printf '%s\\n%s\\n' "$CODEX_ROOTS" ${quotePosixShell(roots.codex.join('\n'))} | sort -u | while IFS= read -r r; do compactcfg codex "$r" config.toml; done
`
}

/** `@@COMPACTCFG <provider> <root> [base64]` (roots may hold spaces, base64 never does), then `@@COMPACTOFF <root>`. */
export function discoveredAgentConfigsIn(stdout: string): DiscoveredAgentConfig[] {
  const configs = new Map<string, DiscoveredAgentConfig>()
  for (const line of stdout.split('\n')) {
    const read = /^@@COMPACTCFG (claude|codex) (.*) (\S*)$/u.exec(line)
    if (read) {
      const provider = read[1] === 'codex' ? 'codex' : 'claude'
      const text = read[3] ? Buffer.from(read[3], 'base64').toString('utf8') : null
      configs.set(`${provider} ${read[2]}`, {
        provider,
        root: read[2],
        text,
        autoCompactOff: false
      })
    }
    const off = /^@@COMPACTOFF (.+)$/u.exec(line)
    const config = off ? configs.get(`claude ${off[1]}`) : undefined
    if (config) {
      config.autoCompactOff = true
    }
  }
  return [...configs.values()]
}

// Greedy, so a home that itself sits under a `sessions` folder still finds Codex's own.
const CONFIG_ROOT_OF: Record<LiveSessionProvider, RegExp> = {
  claude: /^(.+)[\\/]projects[\\/][^\\/]+[\\/][^\\/]+\.jsonl$/u,
  codex: /^(.+)[\\/](?:archived_)?sessions[\\/].+\.jsonl$/u
}

/** The config dir a transcript was written under: Claude's `CLAUDE_CONFIG_DIR`, Codex's `CODEX_HOME`. */
export function agentConfigRootOf(provider: LiveSessionProvider, path: string): string | null {
  return CONFIG_ROOT_OF[provider].exec(path)?.[1] ?? null
}

type ConfiguredTranscript = { path: string; summary: { provider: LiveSessionProvider } }

/** What one host's config roots say about auto-compaction, as its latest scan read them. */
export class HostAutoCompactConfig {
  private readonly settings = new Map<string, AgentAutoCompactSettings>()

  /** The roots the next scan reads besides the defaults: those the transcripts read so far live under. */
  rootsOf(transcripts: Iterable<ConfiguredTranscript>): AgentConfigRoots {
    const roots = { claude: new Set<string>(), codex: new Set<string>() }
    for (const { path, summary } of transcripts) {
      const root = agentConfigRootOf(summary.provider, path)
      if (root) {
        roots[summary.provider].add(root)
      }
    }
    return { claude: [...roots.claude], codex: [...roots.codex] }
  }

  absorb(configs: readonly DiscoveredAgentConfig[]): void {
    for (const config of configs) {
      this.settings.set(
        `${config.provider} ${config.root}`,
        config.provider === 'codex'
          ? parseCodexAutoCompactSettings(config.text)
          : parseClaudeAutoCompactSettings(config.text, config.autoCompactOff)
      )
    }
  }

  /** The reading with the point its host compacts at; as read until the host's config is. */
  apply(
    transcript: ConfiguredTranscript,
    context: NativeChatContextUsageSummary | null
  ): NativeChatContextUsageSummary | null {
    const root = agentConfigRootOf(transcript.summary.provider, transcript.path)
    const settings = root ? this.settings.get(`${transcript.summary.provider} ${root}`) : undefined
    if (!context || !settings || !isContextUsageMeasured(context)) {
      return context
    }
    const at = autoCompactAtTokens(settings, context.model, context.windowTokens)
    return at === null ? context : { ...context, autoCompactAtTokens: at }
  }
}

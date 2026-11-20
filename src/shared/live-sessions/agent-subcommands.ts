import type { LiveSessionProvider } from './live-session-types'

/** Subcommands that are tools around sessions (daemons, viewers, setup), not sessions themselves. */
export const AGENT_TOOL_SUBCOMMANDS: Record<LiveSessionProvider, readonly string[]> = {
  claude:
    'agents attach auth auto-mode config doctor gateway import install kill logs mcp plugin plugins purge respawn rm setup-token stop ultrareview update upgrade'.split(
      ' '
    ),
  codex:
    'agents app-server apply archive cloud completion debug delete doctor exec-server features login logout mcp mcp-server migrate-nfs-db migrate-rollouts plugin queue remote-control sandbox unarchive update'.split(
      ' '
    )
}

/** Runs that print and exit, so there is no conversation to type into. */
export const AGENT_ONE_SHOT_SUBCOMMANDS: Record<LiveSessionProvider, readonly string[]> = {
  claude: ['help'],
  codex: ['exec', 'e', 'review', 'a', 'help']
}

export const AGENT_ONE_SHOT_FLAGS: Record<LiveSessionProvider, readonly string[]> = {
  claude: ['-p', '--print', '-v', '--version', '-h', '--help'],
  codex: ['-V', '--version', '-h', '--help']
}

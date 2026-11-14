import { CLI_GLOBAL_FLAGS as GLOBAL_FLAGS } from '../../shared/cli-argument-boundary'
import type { CommandSpec } from '../discovery/command-spec'

// The live-session registry behind Active agents; `--environment` reads a paired host's registry.
export const SEAL_SESSIONS_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['sessions', 'list'],
    summary: 'List agent sessions on every machine, as Active agents shows them',
    usage: 'seal sessions list [--all] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'all'],
    notes: [
      'Reads the registry the sidebar, Home and mobile read: Seal-launched and external Claude Code and Codex sessions.',
      'Grouped by machine; sessions that need you come first, then working, then idle. --all adds ended sessions.'
    ],
    examples: ['seal sessions list', 'seal sessions list --all --json']
  }
]

import { CLI_GLOBAL_FLAGS as GLOBAL_FLAGS } from '../../shared/cli-argument-boundary'
import type { CommandSpec } from '../discovery/command-spec'

// The live-session registry every session list reads; `--environment` reads a paired host's registry.
export const SEAL_SESSIONS_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['sessions', 'list'],
    summary: 'List agent sessions on every machine, by project and workspace',
    usage: 'seal sessions list [--machine <name-or-id>] [--project <name>] [--all] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'all', 'machine', 'project'],
    notes: [
      'Reads the registry the sidebar, Home and mobile read: chats, agents in Seal panes and sessions started outside Seal, of every agent.',
      'One row per session with its project, workspace and machine. Rows are ordered by project, then workspace; in a workspace, sessions that need you come first, then working, then idle. --all adds ended sessions.',
      '--machine takes a machine name (any letter case) or id; --project takes a project name (any letter case) or key.',
      '--json prints the registry snapshot, ended sessions included, narrowed by --machine and --project.'
    ],
    examples: [
      'seal sessions list',
      'seal sessions list --machine gpu-box --project seal',
      'seal sessions list --all --json'
    ]
  }
]

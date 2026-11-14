import type { CommandSpec } from '../discovery/command-spec'
import { CLI_GLOBAL_FLAGS as GLOBAL_FLAGS } from '../../shared/cli-argument-boundary'

export const PORTS_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['ports'],
    summary: 'List the listening ports Seal detected for a workspace',
    usage: 'seal ports [--worktree <selector>] [--all] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'worktree', 'all'],
    notes: [
      'Defaults to the Seal workspace that contains the current directory.',
      'Scans the host the workspace runs on and lists the ports Seal tied to it, by process working directory (match=cwd) or command line (match=command).',
      '--all lists every listener found on that host, including other workspaces and processes Seal could not tie to one. A native folder workspace needs --all, because Seal does not tie ports to folders.',
      'url is the address the dev server printed in a Seal terminal; it is missing when Seal did not see one.'
    ],
    examples: [
      'seal ports',
      'seal ports --worktree branch:feature/login --json',
      'seal ports --all',
      "seal ports --json | jq -r '.result.ports[0].advertisedUrl'"
    ]
  }
]

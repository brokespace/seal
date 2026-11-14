import type { CommandSpec } from '../discovery/command-spec'
import { CLI_GLOBAL_FLAGS as GLOBAL_FLAGS } from '../../shared/cli-argument-boundary'

export const REPO_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['repo', 'list'],
    summary: 'List repos registered in Seal',
    usage: 'seal repo list [--json]',
    allowedFlags: [...GLOBAL_FLAGS]
  },
  {
    path: ['repo', 'add'],
    summary: 'Add a project to Seal by filesystem path',
    usage: 'seal repo add --path <path> [--kind git|folder] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'path', 'kind'],
    notes: [
      'Defaults to git. Use --kind folder for an ordinary directory, including a parent of separate Git repositories; worktrees attached to a folder workspace appear in its Source Control panel, one section each.',
      'With --environment, --path must be an absolute path on that Seal server.'
    ],
    examples: ['seal repo add --path /abs/path/to/folder --kind folder --json']
  },
  {
    path: ['repo', 'show'],
    summary: 'Show one registered repo',
    usage: 'seal repo show --repo <selector> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'repo']
  },
  {
    path: ['repo', 'set'],
    summary: 'Set whether non-Seal worktrees are shown for a repo',
    usage:
      'seal repo set --repo <selector> --external-worktree-visibility show|hide|inherit [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'repo', 'external-worktree-visibility'],
    notes: [
      'show and hide override the global non-Seal worktree visibility default for this repo; inherit clears the override.',
      'Per-worktree visibility rules still apply.'
    ],
    examples: ['seal repo set --repo path:/path/to/repo --external-worktree-visibility show --json']
  },
  {
    path: ['repo', 'hide'],
    summary: "Hide a project from Seal's sidebar",
    usage: 'seal repo hide --repo <selector> [--host <host>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'repo', 'host'],
    notes: [
      'Only the view changes: open terminals, agents, automations and scripts keep running, and repo list still lists the repo with hiddenAt set.',
      "Hiding applies to one host's copy; with --host, it picks which copy of a repo set up on several hosts.",
      'On a paired Seal server the flag lives on that server, so it hides the project for everyone connected to it.'
    ],
    examples: ['seal repo hide --repo name:orca --json']
  },
  {
    path: ['repo', 'unhide'],
    summary: "Show a hidden project in Seal's sidebar again",
    usage: 'seal repo unhide --repo <selector> [--host <host>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'repo', 'host'],
    notes: ["Shows one host's copy again; on a paired Seal server, for everyone connected to it."]
  },
  {
    path: ['repo', 'set-base-ref'],
    summary: "Set the repo's default base ref for future worktrees",
    usage: 'seal repo set-base-ref --repo <selector> --ref <ref> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'repo', 'ref']
  },
  {
    path: ['repo', 'search-refs'],
    summary: 'Search branch/tag refs within a repo',
    usage: 'seal repo search-refs --repo <selector> --query <text> [--limit <n>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'repo', 'query', 'limit']
  }
]

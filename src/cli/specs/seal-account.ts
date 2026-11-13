import { CLI_GLOBAL_FLAGS as GLOBAL_FLAGS } from '../../shared/cli-argument-boundary'
import { LOCAL_COMMAND_FLAGS } from '../arguments/args'
import type { CommandSpec } from '../discovery/command-spec'

const AGENT_NOTE =
  '--agent is claude or codex. --environment <id> runs the command against that paired host, which swaps its own logins.'
const ACCOUNT_REF_NOTE =
  '--account takes an alias, email, Seal account key (e.g. `claude:me@x.com`) or this host’s account id.'

// Seal's account vault, auto-swap and policies; `--environment` targets a paired remote host.
export const SEAL_ACCOUNT_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['account', 'usage'],
    summary: 'Show every account with its live 5h/7d usage, limits and swap state',
    usage: 'orca account usage [--agent claude|codex] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'agent'],
    notes: [
      'Refreshes stale usage first. `*` marks the account new launches use; `!` a dead login; `q` a quarantined one.',
      AGENT_NOTE
    ],
    examples: ['orca account usage', 'orca account usage --agent codex --json']
  },
  {
    path: ['account', 'current'],
    summary: 'Show which account this session and this host run on',
    usage: 'orca account current [--agent claude|codex] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'agent'],
    notes: [
      'Inside a Seal-launched agent session, reports the account the launch picked (SEAL_ACCOUNT_KEY), then the host’s selected account.'
    ]
  },
  {
    path: ['account', 'swap'],
    summary: 'Switch the host’s selected account now, or run the auto-swap check',
    usage: 'orca account swap --agent claude|codex [--account <ref>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'agent', 'account'],
    notes: [
      'Without --account, applies the auto-swap rules immediately (ignoring the cooldown) and switches only if an account is over its threshold or its login died.',
      'Running sessions keep their login; only new launches move.',
      ACCOUNT_REF_NOTE
    ],
    examples: ['orca account swap --agent claude', 'orca account swap --agent codex --account work']
  },
  {
    path: ['account', 'pick'],
    summary: 'Preview which account a new launch would get, and why',
    usage: 'orca account pick --agent claude|codex [--worktree-id <id>] [--account <ref>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'agent', 'worktree-id', 'account'],
    notes: [
      'Applies the same override, workspace pin, project/machine policy and ranking a launch does, without launching.',
      '--worktree-id defaults to this terminal’s workspace.'
    ]
  },
  {
    path: ['account', 'alias'],
    summary: 'Set an account’s alias, plan, priority, thresholds or disable it',
    usage:
      'orca account alias --account <ref> [--alias <name>] [--plan <name>] [--priority <0-1000>] [--session-threshold <pct>] [--weekly-threshold <pct>] [--disabled on|off] [--json]',
    allowedFlags: [
      ...GLOBAL_FLAGS,
      'account',
      'alias',
      'plan',
      'priority',
      'session-threshold',
      'weekly-threshold',
      'disabled'
    ],
    notes: [
      'Lower priority is preferred. Disabled accounts are never picked automatically; explicit overrides still work.',
      'An empty value (`--alias ""`) clears that field.',
      ACCOUNT_REF_NOTE
    ],
    examples: ['orca account alias --account me@work.example --alias work --priority 10']
  },
  {
    path: ['account', 'autoswap'],
    summary: 'Show or change auto-swap rules for an agent',
    usage:
      'orca account autoswap --agent claude|codex [--enabled on|off] [--strategy best|weekly-first|consume-first|priority] [--session-threshold <pct>] [--weekly-threshold <pct>] [--hysteresis <pct>] [--cooldown <minutes>] [--quarantine <minutes>] [--failover on|off] [--model-limits on|off] [--api-key-fallback on|off] [--live-sessions on|off] [--json]',
    allowedFlags: [
      ...GLOBAL_FLAGS,
      'agent',
      'enabled',
      'strategy',
      'session-threshold',
      'weekly-threshold',
      'hysteresis',
      'cooldown',
      'quarantine',
      'failover',
      'model-limits',
      'api-key-fallback',
      'live-sessions'
    ],
    notes: [
      'best: most headroom. weekly-first: lowest weekly use. consume-first: the allowance resetting soonest. priority: account priority order.',
      'A target must sit `hysteresis` points under each threshold; threshold swaps wait out the cooldown, dead logins fail over at once and are quarantined.',
      '--live-sessions (default on) also moves running sessions: Claude takes the new login live; Codex does when its login died, and otherwise resumes the conversation on the new account.'
    ],
    examples: [
      'orca account autoswap --agent claude --enabled on --strategy weekly-first',
      'orca account autoswap --agent codex --session-threshold 85 --cooldown 15'
    ]
  },
  {
    path: ['account', 'policy', 'list'],
    summary: 'List project and machine account rules',
    usage: 'orca account policy list [--json]',
    allowedFlags: [...GLOBAL_FLAGS]
  },
  {
    path: ['account', 'policy', 'set'],
    summary: 'Restrict or default the accounts a project or machine uses',
    usage:
      'orca account policy set --agent claude|codex (--project <pattern> | --machine <key>) [--allow <ref,ref>] [--default <ref|none>] [--label <name>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'agent', 'project', 'machine', 'allow', 'default', 'label'],
    notes: [
      '--project matches a git remote (`github.com/acme/api`), repo path, folder or display name; `*` globs, exact rules win.',
      '--machine is `local` or `runtime:<environment-id>`. Project and machine allow-lists intersect; the project default wins.',
      '--allow "" allows every account again.'
    ],
    examples: [
      'orca account policy set --agent claude --project "github.com/acme/*" --allow work,work-backup --default work',
      'orca account policy set --agent codex --machine runtime:gpu-box --default ci'
    ]
  },
  {
    path: ['account', 'policy', 'rm'],
    summary: 'Remove a project or machine account rule',
    usage: 'orca account policy rm (--project <pattern> | --machine <key>) [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'project', 'machine']
  },
  {
    path: ['account', 'pin'],
    summary: 'Pin a workspace’s new sessions to one account',
    usage:
      'orca account pin --agent claude|codex --account <ref|none> [--worktree-id <id>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'agent', 'account', 'worktree-id'],
    notes: [
      'Sessions launched in that workspace (and typed `claude`/`codex` in its terminals) run on the pinned account, even after the host swaps.',
      'For one launch only, set SEAL_ACCOUNT=<ref> (or SEAL_CLAUDE_ACCOUNT / SEAL_CODEX_ACCOUNT) in the launch environment.'
    ]
  },
  {
    path: ['account', 'key', 'add'],
    summary: 'Store an Anthropic or OpenAI API key in the OS keychain',
    usage: 'orca account key add --agent claude|codex --label <name> --key-file <path|-> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'agent', 'label', 'key-file'],
    notes: [
      'Pass `--key-file -` and pipe the key on stdin so it never appears in shell history or argv.',
      'Keys are encrypted with the OS keychain (Electron safeStorage or the host secret store) and refused where none is available. They are used per session or workspace, or as an auto-swap fallback.'
    ],
    examples: ['pbpaste | orca account key add --agent claude --label "team key" --key-file -']
  },
  {
    path: ['account', 'key', 'rm'],
    destructive: true,
    summary: 'Delete a stored API key',
    usage: 'orca account key rm --id <id> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'id']
  },
  {
    path: ['account', 'sync'],
    summary: 'Push account policy, and optionally logins, to paired remote hosts',
    usage: 'orca account sync --to <environment-id,...> [--accounts <ref,...>] [--json]',
    allowedFlags: [...LOCAL_COMMAND_FLAGS, 'to', 'accounts'],
    notes: [
      'Runs on the desktop: each host receives the policy and the listed logins, then swaps on its own.',
      'Claude and Codex rotate refresh tokens; re-sync a login if a host reports it dead.'
    ],
    examples: ['orca account sync --to gpu-box --accounts work,ci']
  },
  {
    path: ['account', 'sessions'],
    summary: 'List recent sessions, the account each runs on, and its swap history',
    usage: 'orca account sessions [--json]',
    allowedFlags: [...GLOBAL_FLAGS]
  },
  {
    path: ['account', 'session', 'swap'],
    summary: 'Move one running session to another account',
    usage: 'orca account session swap --session <id> --account <ref> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'session', 'account'],
    notes: [
      'Session ids (or a unique prefix) come from `orca account sessions`.',
      'A session with its own login copy switches live; otherwise Seal stops the agent and resumes the conversation on the new account.',
      ACCOUNT_REF_NOTE
    ],
    examples: ['orca account session swap --session 3f2a --account personal']
  },
  {
    path: ['account', 'session', 'live'],
    summary: 'Turn live auto-swap on or off for one session',
    usage: 'orca account session live --session <id> --mode inherit|on|off [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'session', 'mode'],
    examples: ['orca account session live --session 3f2a --mode off']
  }
]

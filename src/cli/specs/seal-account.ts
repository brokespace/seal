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
    usage: 'seal account usage [--agent claude|codex] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'agent'],
    notes: [
      'Refreshes stale usage first. `*` marks the account new sessions start on; rows are in order of preference.',
      AGENT_NOTE
    ],
    examples: ['seal account usage', 'seal account usage --agent codex --json']
  },
  {
    path: ['account', 'current'],
    summary: 'Show which account this session and this host run on',
    usage: 'seal account current [--agent claude|codex] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'agent'],
    notes: [
      'Inside a Seal-launched agent session, reports the account the launch picked (SEAL_ACCOUNT_KEY), then the host’s selected account.'
    ]
  },
  {
    path: ['account', 'swap'],
    summary: 'Switch the host’s selected account now, or run the auto-swap check',
    usage: 'seal account swap --agent claude|codex [--account <ref>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'agent', 'account'],
    notes: [
      'Without --account, applies the auto-swap rules immediately (ignoring the cooldown) and switches only if an account is over its threshold or its login died.',
      'Running sessions keep their login; only new launches move.',
      ACCOUNT_REF_NOTE
    ],
    examples: ['seal account swap --agent claude', 'seal account swap --agent codex --account work']
  },
  {
    path: ['account', 'pick'],
    summary: 'Preview which account a new launch would get, and why',
    usage: 'seal account pick --agent claude|codex [--worktree-id <id>] [--account <ref>] [--json]',
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
      'seal account alias --account <ref> [--alias <name>] [--plan <name>] [--priority <0-1000>] [--session-threshold <pct>] [--weekly-threshold <pct>] [--disabled on|off] [--json]',
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
    examples: ['seal account alias --account me@work.example --alias work --priority 10']
  },
  {
    path: ['account', 'autoswap'],
    summary: 'Show or change auto-swap rules for an agent',
    usage:
      'seal account autoswap --agent claude|codex [--enabled on|off] [--strategy best|weekly-first|consume-first|priority] [--session-threshold <pct>] [--weekly-threshold <pct>] [--hysteresis <pct>] [--cooldown <minutes>] [--quarantine <minutes>] [--failover on|off] [--model-limits on|off] [--api-key-fallback on|off] [--live-sessions on|off] [--rate-limit-fallback on|off] [--json]',
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
      'live-sessions',
      'rate-limit-fallback'
    ],
    notes: [
      'best: most headroom. weekly-first: lowest weekly use. consume-first: the allowance resetting soonest. priority: account priority order.',
      'Defaults follow claude-swap: swap once the 5h or 7d window reaches 90%, only to an account under its own limits with `hysteresis` (10) more points of headroom, at most once per cooldown (5 min). A full window or dead login swaps at once; dead logins are quarantined.',
      'Usage is polled per account: in-use accounts every 3-5 min (every 1 min while a window climbs within 15 points of its limit), others every 5-10 min, exhausted ones every 10 min.',
      '--live-sessions (default on) moves running sessions on that polled usage: Claude takes the new login live; Codex does when its login died, and otherwise resumes the conversation on the new account.',
      '--rate-limit-fallback (default on) is a last resort: a session that prints a usage-limit stop polling missed is moved too.'
    ],
    examples: [
      'seal account autoswap --agent claude --enabled on --strategy weekly-first',
      'seal account autoswap --agent codex --session-threshold 85 --cooldown 15'
    ]
  },
  {
    path: ['account', 'policy', 'list'],
    summary: 'List project and machine account rules',
    usage: 'seal account policy list [--json]',
    allowedFlags: [...GLOBAL_FLAGS]
  },
  {
    path: ['account', 'policy', 'set'],
    summary: 'Restrict or default the accounts a project or machine uses',
    usage:
      'seal account policy set --agent claude|codex (--project <pattern> | --machine <key>) [--allow <ref,ref>] [--default <ref|none>] [--label <name>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'agent', 'project', 'machine', 'allow', 'default', 'label'],
    notes: [
      '--project matches a git remote (`github.com/acme/api`), repo path, folder or display name; `*` globs, exact rules win.',
      '--machine is `local` or `runtime:<environment-id>`. Project and machine allow-lists intersect; the project default wins.',
      '--allow "" allows every account again.'
    ],
    examples: [
      'seal account policy set --agent claude --project "github.com/acme/*" --allow work,work-backup --default work',
      'seal account policy set --agent codex --machine runtime:gpu-box --default ci'
    ]
  },
  {
    path: ['account', 'policy', 'rm'],
    summary: 'Remove a project or machine account rule',
    usage: 'seal account policy rm (--project <pattern> | --machine <key>) [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'project', 'machine']
  },
  {
    path: ['account', 'pin'],
    summary: 'Pin a workspace’s new sessions to one account',
    usage:
      'seal account pin --agent claude|codex --account <ref|none> [--worktree-id <id>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'agent', 'account', 'worktree-id'],
    notes: [
      'Sessions launched in that workspace (and typed `claude`/`codex` in its terminals) run on the pinned account, even after the host swaps.',
      'For one launch only, set SEAL_ACCOUNT=<ref> (or SEAL_CLAUDE_ACCOUNT / SEAL_CODEX_ACCOUNT) in the launch environment.'
    ]
  },
  {
    path: ['account', 'import'],
    summary: 'Add this machine’s own claude or codex login to Seal',
    usage: 'seal account import --agent claude|codex [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'agent'],
    notes: [
      'Seal lists the machine’s CLI login on its own until you remove it; this adds it back afterwards.',
      'Nothing is copied: the login stays where the CLI keeps it and Seal uses it in place.'
    ],
    examples: ['seal account import --agent claude']
  },
  {
    path: ['account', 'remove'],
    destructive: true,
    summary: 'Remove an account from Seal, optionally signing the machine’s CLI out too',
    usage: 'seal account remove --account <ref> [--agent claude|codex] [--logout] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'account', 'agent', 'logout'],
    notes: [
      'Deletes the login or secret Seal saved and drops the account from every rule. Running sessions keep going until they end.',
      'For the machine’s own CLI login, removal only hides it from Seal and it stays hidden across restarts. Pass --logout to also run `claude auth logout` / `codex logout`.',
      ACCOUNT_REF_NOTE
    ],
    examples: [
      'seal account remove --account old@example.com',
      'seal account remove --account me@example.com --agent claude --logout'
    ]
  },
  {
    path: ['account', 'order'],
    summary: 'Set the order of preference for a provider’s accounts',
    usage: 'seal account order --agent claude|codex --accounts <ref,ref,...> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'agent', 'accounts'],
    notes: [
      'Listed accounts get priorities 10, 20, … in that order; lower runs first. List every account of the provider to set the whole order.',
      ACCOUNT_REF_NOTE
    ],
    examples: ['seal account order --agent claude --accounts work,personal']
  },
  {
    path: ['account', 'token', 'add'],
    summary: 'Store a `claude setup-token` token as a Claude account',
    usage: 'seal account token add --label <name> --token-file <path|-> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'label', 'token-file'],
    notes: [
      'Pass `--token-file -` and pipe the token on stdin so it never appears in shell history or argv.',
      'The token runs on your Claude subscription and lasts one year; Claude reports no usage for it.'
    ],
    examples: ['claude setup-token | tail -1 | seal account token add --label ci --token-file -']
  },
  {
    path: ['account', 'key', 'add'],
    summary: 'Store an Anthropic or OpenAI API key in the OS keychain',
    usage: 'seal account key add --agent claude|codex --label <name> --key-file <path|-> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'agent', 'label', 'key-file'],
    notes: [
      'Pass `--key-file -` and pipe the key on stdin so it never appears in shell history or argv.',
      'Keys are encrypted with the OS keychain (Electron safeStorage or the host secret store) and refused where none is available. They are used per session or workspace, or as an auto-swap fallback.'
    ],
    examples: ['pbpaste | seal account key add --agent claude --label "team key" --key-file -']
  },
  {
    path: ['account', 'key', 'rm'],
    destructive: true,
    summary: 'Delete a stored API key',
    usage: 'seal account key rm --id <id> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'id']
  },
  {
    path: ['account', 'sync'],
    summary: 'Push account policy, and optionally logins, to paired remote hosts',
    usage: 'seal account sync --to <environment-id,...> [--accounts <ref,...>] [--json]',
    allowedFlags: [...LOCAL_COMMAND_FLAGS, 'to', 'accounts'],
    notes: [
      'Runs on the desktop: each host receives the policy and the listed logins, then swaps on its own.',
      'Claude and Codex rotate refresh tokens; re-sync a login if a host reports it dead.'
    ],
    examples: ['seal account sync --to gpu-box --accounts work,ci']
  },
  {
    path: ['account', 'sessions'],
    summary: 'List recent sessions, the account each runs on, and its swap history',
    usage: 'seal account sessions [--json]',
    allowedFlags: [...GLOBAL_FLAGS]
  },
  {
    path: ['account', 'session', 'swap'],
    summary: 'Move one running session to another account',
    usage: 'seal account session swap --session <id> --account <ref> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'session', 'account'],
    notes: [
      'Session ids (or a unique prefix) come from `seal account sessions`.',
      'A session with its own login copy switches live; otherwise Seal stops the agent and resumes the conversation on the new account.',
      ACCOUNT_REF_NOTE
    ],
    examples: ['seal account session swap --session 3f2a --account personal']
  },
  {
    path: ['account', 'session', 'live'],
    summary: 'Turn live auto-swap on or off for one session',
    usage: 'seal account session live --session <id> --mode inherit|on|off [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'session', 'mode'],
    examples: ['seal account session live --session 3f2a --mode off']
  }
]

import type { HomeChatToolName } from './home-chat-tool-definitions'

export type HomeChatToolRisk =
  | { requiresApproval: false }
  | { requiresApproval: true; reason: string }

const SAFE: HomeChatToolRisk = { requiresApproval: false }

type ShellRule = { pattern: RegExp; reason: string }

// Matched per shell segment, so `cd x && rm -rf y` is still caught.
const SHELL_RULES: readonly ShellRule[] = [
  { pattern: /^(sudo\s+)?(rm|rmdir|unlink|shred|srm)\b/, reason: 'deletes files' },
  { pattern: /^(sudo\s+)?find\b.*\s(-delete|-exec\s+rm)\b/, reason: 'deletes files' },
  { pattern: /^(sudo\s+)?(remove-item|del|erase|rd)\b/i, reason: 'deletes files' },
  { pattern: /^(sudo\s+)?(mkfs|dd|fdisk|parted|wipefs)\b/, reason: 'can overwrite disks' },
  {
    pattern: /^git\b.*\bpush\b.*(\s--force\b|\s--force-with-lease\b|\s-f\b|\s\+\S)/,
    reason: 'force-pushes'
  },
  { pattern: /^git\b.*\bpush\b.*\s(--delete|-d)\b/, reason: 'deletes a remote branch' },
  { pattern: /^git\b.*\breset\b.*--hard\b/, reason: 'discards uncommitted work' },
  { pattern: /^git\b.*\bclean\b.*\s-\w*f/, reason: 'deletes untracked files' },
  { pattern: /^git\b.*\bbranch\b.*\s(-D|--delete\s+--force)\b/, reason: 'deletes a branch' },
  { pattern: /^git\b.*\b(checkout|restore)\b.*\s(--\s+)?\.$/, reason: 'discards changes' },
  {
    pattern:
      /^gh\b.*\b(pr\s+(merge|close)|release\s+(create|delete)|repo\s+delete|issue\s+close)\b/,
    reason: 'publishes or closes on GitHub'
  },
  { pattern: /^(sendmail|mail|mailx|mutt)\b/, reason: 'sends email' },
  {
    pattern:
      /^(curl|wget|http|xh)\b.*(\s-X\s*(POST|PUT|PATCH|DELETE)\b|\s(-d|--data\S*|-F|--form|--upload-file|-T)\b)/i,
    reason: 'sends data over the network'
  },
  { pattern: /^(sudo\s+)?(shutdown|reboot|halt|poweroff)\b/, reason: 'shuts the machine down' },
  { pattern: /^(sudo\s+)?(kill|pkill|killall)\b/, reason: 'stops processes' },
  {
    pattern: /^(sudo\s+)?(docker|podman)\b.*\b(rm|rmi|prune)\b/,
    reason: 'deletes containers or images'
  },
  { pattern: /^(sudo\s+)?(chmod|chown)\b.*\s-\w*R/, reason: 'changes permissions recursively' },
  { pattern: /^(npm|pnpm|yarn)\s+publish\b/, reason: 'publishes a package' }
]

/** Split on shell separators and pipes; quoting is ignored, which only errs toward asking. */
function shellSegments(command: string): string[] {
  return command
    .split(/&&|\|\||[;|\n]|\$\(|`/)
    .map((segment) => segment.trim().replace(/^[({\s]+/, ''))
    .filter(Boolean)
}

export function assessShellCommandRisk(command: string): HomeChatToolRisk {
  for (const segment of shellSegments(command)) {
    const rule = SHELL_RULES.find((candidate) => candidate.pattern.test(segment))
    if (rule) {
      return { requiresApproval: true, reason: `This command ${rule.reason}.` }
    }
  }
  return SAFE
}

/** Seal CLI calls that remove work or type into a running agent. */
function assessOrcaArgs(args: readonly string[]): HomeChatToolRisk {
  const command = args
    .filter((arg) => !arg.startsWith('-'))
    .slice(0, 3)
    .join(' ')
  if (/^(worktree rm|project setup-delete|workspace cleanup run)\b/.test(command)) {
    return { requiresApproval: true, reason: 'This removes Seal workspaces or projects.' }
  }
  if (/^terminal (close|stop)\b/.test(command)) {
    return { requiresApproval: true, reason: 'This stops a running terminal.' }
  }
  if (command === 'terminal send' && args.includes('--interrupt')) {
    return { requiresApproval: true, reason: 'This interrupts a running agent.' }
  }
  return SAFE
}

export function assessHomeChatToolRisk(
  tool: HomeChatToolName,
  input: Record<string, unknown>
): HomeChatToolRisk {
  switch (tool) {
    case 'run_command':
      return assessShellCommandRisk(String(input.command ?? ''))
    case 'delete_path':
      return { requiresApproval: true, reason: `This deletes ${String(input.path)}.` }
    case 'seal_cli':
      return assessOrcaArgs(Array.isArray(input.args) ? input.args.map(String) : [])
    case 'take_over_session':
      return {
        requiresApproval: true,
        reason: 'This stops an agent running outside Seal and resumes it in a Seal pane.'
      }
    case 'switch_account':
      return {
        requiresApproval: true,
        reason: `This changes the active ${String(input.provider)} account for new sessions.`
      }
    // Jobs, subagents and routines are the assistant's own; routine runs still hit approvals.
    case 'list_machines':
    case 'job_status':
    case 'job_output':
    case 'job_kill':
    case 'job_cleanup':
    case 'read_file':
    case 'write_file':
    case 'transfer_file':
    case 'configure_machine':
    case 'attach_file':
    case 'report_progress':
    case 'remember':
    case 'forget':
    case 'load_skill':
    case 'list_skills':
    case 'list_sessions':
    case 'read_session':
    case 'message_session':
    case 'start_session':
    case 'account_usage':
    case 'open_in_seal':
    case 'spawn_subagent':
    case 'check_subagent':
    case 'message_subagent':
    case 'stop_subagent':
    case 'web_search':
    case 'web_fetch':
    case 'routines':
      return SAFE
  }
}

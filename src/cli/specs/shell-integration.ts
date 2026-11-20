import type { CommandSpec } from '../discovery/command-spec'
import { LOCAL_COMMAND_FLAGS } from '../arguments/args'

const FLAGS = [...LOCAL_COMMAND_FLAGS, 'ssh']
const NOTES = [
  'Wraps claude and codex started from zsh or bash in a private tmux server (tmux -L seal) so Seal can send them messages. Your own tmux server and ~/.tmux.conf are never touched.',
  'Runs the real binary unchanged inside tmux or a Seal pane, when stdin/stdout is not a terminal, for one-shot commands like `claude -p`, or with SEAL_NO_WRAP=1.',
  '--ssh <destination> runs the same step on an SSH host through your ssh config.'
]

const action = (name: string, summary: string): CommandSpec => ({
  path: ['shell-integration', name],
  summary,
  usage: `seal shell-integration ${name} [--ssh <destination>] [--json]`,
  allowedFlags: FLAGS,
  examples: [`seal shell-integration ${name}`, `seal shell-integration ${name} --ssh build-box`],
  notes: NOTES
})

export const SHELL_INTEGRATION_COMMAND_SPECS: CommandSpec[] = [
  action(
    'install',
    'Wrap claude and codex in your shells so Seal can message sessions started outside it'
  ),
  action('uninstall', 'Remove the claude/codex wrappers and their rc-file blocks'),
  action('status', 'Show whether the claude/codex wrappers are installed and enabled'),
  action('enable', 'Turn the installed wrappers back on'),
  action('disable', 'Keep the wrappers installed but run claude and codex directly')
]

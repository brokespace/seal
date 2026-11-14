import type { CommandSpec } from '../discovery/command-spec'
import { LOCAL_COMMAND_FLAGS } from '../arguments/args'

export const AGENT_HOOK_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['agent', 'hooks', 'prepare-codex'],
    summary: "Prepare a WSL pane's Seal-managed Codex home before a shell launch",
    usage: 'seal agent hooks prepare-codex',
    allowedFlags: [...LOCAL_COMMAND_FLAGS]
  },
  {
    path: ['agent', 'hooks', 'status'],
    summary: 'Show whether Seal-managed agent status hooks are enabled',
    usage: 'seal agent hooks status [--json]',
    allowedFlags: [...LOCAL_COMMAND_FLAGS],
    examples: ['seal agent hooks status', 'seal agent hooks status --json']
  },
  {
    path: ['agent', 'hooks', 'off'],
    summary: 'Disable Seal-managed agent status hooks and remove local hook entries',
    usage: 'seal agent hooks off [--json]',
    allowedFlags: [...LOCAL_COMMAND_FLAGS],
    examples: ['seal agent hooks off']
  },
  {
    path: ['agent', 'hooks', 'on'],
    summary: 'Enable Seal-managed agent status hooks',
    usage: 'seal agent hooks on [--json]',
    allowedFlags: [...LOCAL_COMMAND_FLAGS],
    examples: ['seal agent hooks on']
  }
]

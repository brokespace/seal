import type { CommandSpec } from '../discovery/command-spec'
import { LOCAL_COMMAND_FLAGS } from '../arguments/args'

export const INTROSPECTION_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['agent-context'],
    summary: 'Print the machine-readable command schema for agents',
    usage: 'seal agent-context [--json]',
    allowedFlags: [...LOCAL_COMMAND_FLAGS],
    notes: [
      'Pure local read of the command registry — works without a running Seal app, so it is safe over SSH and in headless contexts.'
    ],
    examples: ['seal agent-context --json']
  }
]

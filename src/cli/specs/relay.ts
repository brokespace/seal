import type { CommandSpec } from '../discovery/command-spec'
import { LOCAL_COMMAND_FLAGS } from '../arguments/args'

export const RELAY_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['relay', 'host-id'],
    summary: 'Print the id the Seal relay knows this machine by',
    usage: 'seal relay host-id [--json]',
    allowedFlags: [...LOCAL_COMMAND_FLAGS],
    notes: [
      'A relay serves only the hosts on its allowlist. Give this id to whoever runs the relay (HOST_ALLOWLIST; see docs/security/relay-deploy.md).',
      'The id is derived from this profile’s pairing key, which is created the first time Seal runs here (the app or `seal serve`). It is not a secret, and it is the id a phone shows when it pairs.',
      'Reads the profile on disk; Seal does not need to be running.'
    ],
    examples: ['seal relay host-id', 'seal relay host-id --json']
  }
]

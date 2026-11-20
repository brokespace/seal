import type { CommandSpec } from '../discovery/command-spec'
import { LOCAL_COMMAND_FLAGS } from '../arguments/args'

const OWNER_NOTE =
  'Only this machine’s own user can run it, on the machine itself: paired clients and phones cannot list or revoke devices.'

export const DEVICES_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['devices', 'list'],
    summary: 'List the phones and other Orcas paired with the Orca on this machine',
    usage: 'orca devices list [--json]',
    allowedFlags: [...LOCAL_COMMAND_FLAGS],
    notes: [
      'Shows each device’s id, name, scope (mobile or runtime), when it paired and was last seen, and how it reaches this host (direct, relay, or through a paired desktop). Credentials are never printed.',
      'Unused pairing offers are listed too, with the time they stop working.',
      'Asks the Orca running for this profile (desktop app, `orca serve`, or its service). When none runs it reads the device registry on disk.',
      OWNER_NOTE
    ],
    examples: ['orca devices list', 'orca devices list --json']
  },
  {
    path: ['devices', 'revoke'],
    summary: 'Revoke a paired device: it is disconnected at once and can no longer sign in',
    usage: 'orca devices revoke (<deviceId> | --all) [--json]',
    destructive: true,
    allowedFlags: [...LOCAL_COMMAND_FLAGS, 'device', 'all'],
    positionalArgs: ['device'],
    notes: [
      'The same revoke as the desktop app’s Settings: the device’s connections are closed, its relay credential and push registration are withdrawn, and everything paired through it (its browser keys, the phones a desktop relays) is revoked with it.',
      'When no Orca runs for this profile, the device is removed from the registry on disk and the relay and push withdrawals are queued; the next start sends them. The output says which happened.',
      '--all revokes every paired device and unused offer. The device must pair again to regain access.',
      OWNER_NOTE
    ],
    examples: [
      'orca devices list',
      'orca devices revoke 4b1fde8b-c665-4aa7-bb29-45795dc05e42',
      'orca devices revoke --all --json'
    ]
  }
]

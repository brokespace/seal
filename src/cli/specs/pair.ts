import type { CommandSpec } from '../discovery/command-spec'
import { CLI_GLOBAL_FLAGS as GLOBAL_FLAGS } from '../../shared/cli-argument-boundary'

export const PAIR_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['pair'],
    summary:
      'Pair a phone or another Seal with the Seal already running here, without restarting it',
    usage:
      'seal pair [--mobile [--relay]] [--address <host>] [--grant-desktop-control] [--rotate] [--json]',
    allowedFlags: [
      ...GLOBAL_FLAGS,
      'mobile',
      'relay',
      'address',
      'grant-desktop-control',
      'rotate'
    ],
    notes: [
      'Asks the Seal running for this profile (desktop app, `seal serve`, or its service) for a pairing offer. Nothing restarts and existing clients stay connected.',
      'Without --mobile it prints an access link for another Seal (Settings → Remote Seal Servers → Add Server). --mobile prints a QR code and link for Seal Mobile.',
      '--address is the host or IP the client should dial, such as a Tailscale address. Without it Seal picks this machine’s default LAN address.',
      'The first network pairing makes a loopback-only Seal listen on every interface, as pairing from the desktop app does.',
      'Mobile pairing is LAN-only (same network or tailnet) unless --relay is given; Relay needs a signed-in desktop app.',
      'An unused offer is reused until --rotate replaces it. Clients that already paired keep their access.',
      "--grant-desktop-control lets the paired Seal drive this machine's desktop (seal computer). It applies only to an access link, not to a phone.",
      'Only this machine’s own user can run it: paired clients and phones cannot create pairing offers.'
    ],
    examples: [
      'seal pair --mobile',
      'seal pair --mobile --address 100.64.1.20',
      'seal pair --address 100.64.1.20',
      'seal pair --mobile --rotate --json'
    ]
  }
]

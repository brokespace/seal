import type { CommandSpec } from '../discovery/command-spec'
import { CLI_GLOBAL_FLAGS as GLOBAL_FLAGS } from '../../shared/cli-argument-boundary'

export const PAIR_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['pair'],
    summary:
      'Pair a phone or another Orca with the Orca already running here, without restarting it',
    usage:
      'orca pair [--mobile [--relay]] [--address <host>] [--grant-desktop-control] [--rotate] [--json]',
    allowedFlags: [
      ...GLOBAL_FLAGS,
      'mobile',
      'relay',
      'address',
      'grant-desktop-control',
      'rotate'
    ],
    notes: [
      'Asks the Orca running for this profile (desktop app, `orca serve`, or its service) for a pairing offer. Nothing restarts and existing clients stay connected.',
      'Without --mobile it prints an access link for another Orca (Settings → Remote Orca Servers → Add Server). --mobile prints a QR code and link for Orca Mobile.',
      '--address is the host or IP the client should dial, such as a Tailscale address. Without it Orca picks this machine’s default LAN address.',
      'The first network pairing makes a loopback-only desktop app listen on every interface, as pairing from its Settings does. An `orca serve` listener is never widened: it stays on its --bind address (127.0.0.1 by default).',
      'Mobile pairing is LAN-only (same network or tailnet) unless --relay is given. --relay pairs through Orca Relay, needs no open port, and is the only way to pair a phone with a server that listens on loopback.',
      'An unused offer stops working after 10 minutes (mobile) or 60 minutes (access link); the output states the time. Until its last minute it is reused, unless --rotate replaces it. Clients that already paired keep their access.',
      "--grant-desktop-control lets the paired Orca drive this machine's desktop (orca computer). It applies only to an access link, not to a phone.",
      'Only this machine’s own user can run it: paired clients and phones cannot create pairing offers.'
    ],
    examples: [
      'orca pair --mobile',
      'orca pair --mobile --relay',
      'orca pair --mobile --address 100.64.1.20',
      'orca pair --address 100.64.1.20',
      'orca pair --mobile --rotate --json'
    ]
  }
]

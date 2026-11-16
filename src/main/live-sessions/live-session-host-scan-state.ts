import type { LiveSession } from '../../shared/live-sessions/live-session-types'
import type { LiveSessionHost } from './hosts/live-session-hosts'
import { HostSessionScanner, scanLimitsFor } from './discovery/host-session-scanner'
import type { SealPane } from './seal-panes/seal-pane-sessions'

export type HostScanState = {
  host: LiveSessionHost
  scanner: HostSessionScanner
  sessions: LiveSession[]
  nextScanAt: number
  scanning: boolean
  /** Scans in a row that found nothing new; each stretches the wait, up to MAX_IDLE_STRETCH. */
  idleScans: number
  /** Scans that returned, for the status hold: a session leaves "working" on the second that says so. */
  scans: number
  failures: number
  /** A pane changed status since this host's last scan began: what that scan read is from before it. */
  paneChanged: boolean
}

const MAX_IDLE_STRETCH = 2
const MAX_FAILURE_STRETCH = 4
/** The agent writes its transcript and its own state a moment after the hook that changed its pane. */
const PANE_CHANGE_SCAN_MS = 500

export function newHostScanState(
  host: LiveSessionHost,
  current: () => LiveSessionHost
): HostScanState {
  return {
    host,
    scanner: new HostSessionScanner(
      {
        machine: host.machine,
        run: (script, options) => current().run(script, options),
        transcriptFiles: host.transcriptFiles
      },
      scanLimitsFor(host.machine)
    ),
    sessions: [],
    nextScanAt: 0,
    scanning: false,
    idleScans: 0,
    scans: 0,
    failures: 0,
    paneChanged: false
  }
}

/** How long after a scan the host is read again: sooner while it changes, later while it fails. */
export function nextScanDelayMs(
  state: HostScanState,
  intervals: { local: number; ssh: number }
): number {
  if (state.paneChanged) {
    return PANE_CHANGE_SCAN_MS
  }
  const base = state.host.machine.kind === 'local' ? intervals.local : intervals.ssh
  return (
    base *
    (state.failures > 0
      ? 2 ** Math.min(state.failures, MAX_FAILURE_STRETCH)
      : 2 ** Math.min(state.idleScans, MAX_IDLE_STRETCH))
  )
}

/**
 * A pane that took another status (a turn ended, a prompt was answered) is ahead of what the last
 * scan read of its session: its machine is read again now, not at its next scan.
 */
export class SealPaneStatusChanges {
  private shown = new Map<string, { status: SealPane['status']; local: boolean }>()

  /** Marks the hosts of the panes that changed since the last call; true when any did. */
  mark(panes: SealPane[], hosts: Iterable<HostScanState>, now: number): boolean {
    const before = this.shown
    this.shown = new Map(
      panes.map((pane) => [
        pane.paneKey,
        { status: pane.status, local: pane.connectionId === null }
      ])
    )
    const changed = [
      ...[...this.shown].filter(([key, pane]) => before.get(key)?.status !== pane.status),
      ...[...before].filter(([key]) => !this.shown.has(key))
    ].map(([, pane]) => pane.local)
    for (const state of hosts) {
      if (changed.includes(state.host.machine.kind === 'local')) {
        state.idleScans = 0
        state.paneChanged = true
        state.nextScanAt = Math.min(state.nextScanAt, now + PANE_CHANGE_SCAN_MS)
      }
    }
    return changed.length > 0
  }
}

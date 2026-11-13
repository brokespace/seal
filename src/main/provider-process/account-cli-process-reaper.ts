/** Account sign-in, sign-out and import run short provider CLI commands; none may outlive its flow. */

const DEFAULT_GRACE_MS = 2_000

export type AccountCliChild = {
  pid?: number
  exitCode: number | null
  signalCode: string | null
  kill(signal?: NodeJS.Signals): boolean
}

type TrackableAccountCliChild = AccountCliChild & {
  once(event: 'close', listener: () => void): unknown
}

type Tracked = { child: AccountCliChild; group: boolean }

const live = new Set<Tracked>()
let exitHookInstalled = false

function hasExited(child: AccountCliChild): boolean {
  return child.exitCode !== null || child.signalCode !== null
}

/** Signals the whole process group; false when there is none left (or it was never a group). */
function signalGroup(entry: Tracked, name: NodeJS.Signals): boolean {
  if (!entry.group || !entry.child.pid || process.platform === 'win32') {
    return false
  }
  try {
    // The CLI may be a wrapper script; its group holds the real process too.
    process.kill(-entry.child.pid, name)
    return true
  } catch {
    return false
  }
}

function signal(entry: Tracked, name: NodeJS.Signals): void {
  if (signalGroup(entry, name) || hasExited(entry.child)) {
    return
  }
  try {
    entry.child.kill(name)
  } catch {
    // Already gone.
  }
}

/**
 * Registers a spawned account CLI so it is force-killed if this process exits first. `group`
 * means it was spawned detached on POSIX and leads its own process group.
 */
export function trackAccountCliProcess(
  child: TrackableAccountCliChild,
  options: { group: boolean }
): void {
  const entry: Tracked = { child, group: options.group }
  live.add(entry)
  child.once('close', () => live.delete(entry))
  if (!exitHookInstalled) {
    exitHookInstalled = true
    // A detached login would otherwise survive the app that started it.
    process.once('exit', killAllAccountCliProcesses)
  }
}

/** Asks the CLI to stop, then force-kills whatever is still running after the grace period. */
export function reapAccountCliProcess(
  child: AccountCliChild,
  options: { group: boolean; graceMs?: number }
): void {
  const entry: Tracked = { child, group: options.group }
  signal(entry, 'SIGTERM')
  if (process.platform === 'win32') {
    return
  }
  // Not cancelled when the wrapper exits: a child that ignored SIGTERM is still in its group.
  const timer = setTimeout(() => signal(entry, 'SIGKILL'), options.graceMs ?? DEFAULT_GRACE_MS)
  timer.unref?.()
}

export function killAllAccountCliProcesses(): void {
  for (const entry of live) {
    signal(entry, 'SIGKILL')
  }
  live.clear()
}

export function liveAccountCliProcessCount(): number {
  return [...live].filter((entry) => !hasExited(entry.child)).length
}

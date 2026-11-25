import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { lock } from 'proper-lockfile'

// Claude Code (2.1.218+) refreshes under two proper-lockfile directory locks, in this order:
// `<config>/.oauth_refresh.lock`, then the legacy `<config>.lock`. Both are stale only after 60s
// and touched every 5s, so a live holder is never stolen from. Protocol as documented by
// claude-swap (github.com/realiti4/claude-swap, MIT), `claude_locks.py`.
const CREDENTIALS_STALE_MS = 60_000
const CREDENTIALS_UPDATE_MS = 5_000
// Claude retries a held lock about five times over 5-10s; one refresh round trip fits inside.
const LOCK_RETRIES = { retries: 30, factor: 1, minTimeout: 250, maxTimeout: 500, randomize: true }

export function claudeCredentialLockPaths(configDir: string): [string, string] {
  return [join(configDir, '.oauth_refresh.lock'), `${configDir}.lock`]
}

async function lockOne(path: string): Promise<() => Promise<void>> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  return lock(path, {
    lockfilePath: path,
    realpath: false,
    stale: CREDENTIALS_STALE_MS,
    update: CREDENTIALS_UPDATE_MS,
    retries: LOCK_RETRIES,
    onCompromised: () => {}
  })
}

/**
 * Runs `work` while holding Claude Code's credential-refresh locks on every listed config dir, so
 * no Claude process can refresh (and rotate) one of these logins mid-write. Claude re-reads its
 * credentials after taking the lock, so it adopts whatever Seal wrote instead of overwriting it.
 * Dirs lock in sorted order, each in Claude's own primary-then-legacy order, so Seal and Claude
 * can never deadlock.
 */
export async function withClaudeConfigLocks<T>(
  configDirs: readonly string[],
  work: () => Promise<T>
): Promise<T> {
  const releases: (() => Promise<void>)[] = []
  try {
    for (const dir of [...new Set(configDirs)].sort()) {
      await mkdir(dir, { recursive: true, mode: 0o700 })
      for (const path of claudeCredentialLockPaths(dir)) {
        releases.push(await lockOne(path))
      }
    }
    return await work()
  } finally {
    for (const release of releases.toReversed()) {
      await release().catch(() => {})
    }
  }
}

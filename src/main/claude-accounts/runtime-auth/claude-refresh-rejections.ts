import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { writeSecureFile } from '../../../shared/secure-storage/secure-file'

// Enough to cover every login on a host and its spent predecessors.
const MAX_REJECTIONS = 64

/**
 * Refresh tokens Claude's token endpoint refused (`invalid_grant`), kept by fingerprint so no
 * secret is stored. A newer login carries a new refresh token, so its fingerprint is never here:
 * signing in, pushing a login or Claude's own refresh clears the mark without a reset.
 */
const rejected = new Set<string>()
const listeners = new Set<() => void>()
let persistFile: string | null = null

export function claudeRefreshTokenFingerprint(refreshToken: string): string {
  return createHash('sha256').update(refreshToken).digest('hex').slice(0, 32)
}

export function isClaudeRefreshRejected(refreshToken: string | null | undefined): boolean {
  return Boolean(refreshToken) && rejected.has(claudeRefreshTokenFingerprint(refreshToken ?? ''))
}

export function isClaudeRefreshFingerprintRejected(
  fingerprint: string | null | undefined
): boolean {
  return Boolean(fingerprint) && rejected.has(fingerprint ?? '')
}

export function markClaudeRefreshRejected(refreshToken: string): void {
  const fingerprint = claudeRefreshTokenFingerprint(refreshToken)
  if (rejected.has(fingerprint)) {
    return
  }
  rejected.add(fingerprint)
  while (rejected.size > MAX_REJECTIONS) {
    rejected.delete(rejected.values().next().value ?? '')
  }
  save()
  for (const listener of listeners) {
    listener()
  }
}

export function onClaudeRefreshRejected(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Keeps marks across restarts, so a dead login does not read as signed in until it fails again. */
export function persistClaudeRefreshRejections(file: string): void {
  persistFile = file
  try {
    const saved: unknown = JSON.parse(readFileSync(file, 'utf8'))
    if (Array.isArray(saved)) {
      for (const entry of saved.slice(-MAX_REJECTIONS)) {
        if (typeof entry === 'string' && /^[0-9a-f]{32}$/.test(entry)) {
          rejected.add(entry)
        }
      }
    }
  } catch {
    // No file yet, or an unreadable one: start empty.
  }
}

function save(): void {
  if (!persistFile) {
    return
  }
  try {
    writeSecureFile(persistFile, JSON.stringify([...rejected]))
  } catch (error) {
    console.warn('[claude-accounts] Could not save refused logins:', error)
  }
}

/** Test-only reset of the process-wide registry. */
export function resetClaudeRefreshRejectionsForTest(): void {
  rejected.clear()
  listeners.clear()
  persistFile = null
}

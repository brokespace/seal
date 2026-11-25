import type { SealAccountKey } from './seal-accounts-config'
import { sealAccountKeysMatch } from './seal-account-key'

/** One saved login, as the dedup pass sees it. */
export type SealDedupEntry = {
  id: string
  key: SealAccountKey
  /** The machine's selected account. */
  active: boolean
  /** Its folder holds a login that can start a session. */
  usable: boolean
  /** How new its stored token is; the newest copy holds the live refresh token. */
  freshness: number | null
  lastAuthenticatedAt: number
}

export type SealDedupGroup = {
  key: SealAccountKey
  keep: string
  remove: string[]
  /** The kept copy replaces a removed one as the machine's selection. */
  reselect: boolean
}

function better(left: SealDedupEntry, right: SealDedupEntry): SealDedupEntry {
  if (left.usable !== right.usable) {
    return left.usable ? left : right
  }
  const leftFreshness = left.freshness ?? -1
  const rightFreshness = right.freshness ?? -1
  if (leftFreshness !== rightFreshness) {
    return leftFreshness > rightFreshness ? left : right
  }
  if (left.active !== right.active) {
    return left.active ? left : right
  }
  return right.lastAuthenticatedAt > left.lastAuthenticatedAt ? right : left
}

/**
 * Saved logins that name the same identity (provider plus email, and org or workspace when both
 * report one) collapse to the copy most likely to still work: usable, then newest token, then the
 * selected one, then the most recent sign-in.
 */
export function planSealAccountDedup(entries: readonly SealDedupEntry[]): SealDedupGroup[] {
  const groups: SealDedupEntry[][] = []
  for (const entry of entries) {
    const group = groups.find((members) => sealAccountKeysMatch(members[0].key, entry.key))
    if (group) {
      group.push(entry)
    } else {
      groups.push([entry])
    }
  }
  return groups
    .filter((members) => members.length > 1)
    .map((members) => {
      const keep = members.reduce(better)
      const removed = members.filter((entry) => entry.id !== keep.id)
      // The most specific key (with its org) is the one profiles and rules should follow.
      const key = members.find((entry) => entry.key.includes('#'))?.key ?? keep.key
      return {
        key,
        keep: keep.id,
        remove: removed.map((entry) => entry.id),
        reselect: !keep.active && removed.some((entry) => entry.active)
      }
    })
}

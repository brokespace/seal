/** How long an auto-created workspace outlives its last running session: a take-over or a resume lands in it. */
export const AUTO_CREATED_GRACE_MS = 20_000

/** What Seal sees of a project it made for a session. */
export type AutoCreatedFacts = {
  /** The name Seal gave it, and the one it has now. */
  givenName: string
  displayName: string
  workspaces: readonly {
    pinned: boolean
    renamed: boolean
    hasComment: boolean
    /** Made in Seal, not found in the checkout. */
    createdInSeal: boolean
    /** A tab is open in it, or a terminal or chat runs in it. */
    inUse: boolean
  }[]
  /** Sessions still running in it. */
  runningSessions: number
  /** Its machine has listed its sessions since Seal started. */
  machineRead: boolean
  /** When it was first seen without a running session; null while it has one. */
  emptySince: number | null
}

/**
 * `adopt` clears the mark for good: the user renamed it, pinned it, opened a tab in it or added a
 * workspace to it. `remove` takes it away once its last session has left.
 */
export type AutoCreatedVerdict = 'keep' | 'adopt' | 'remove'

export function autoCreatedVerdict(facts: AutoCreatedFacts, now: number): AutoCreatedVerdict {
  const touched =
    facts.displayName !== facts.givenName ||
    facts.workspaces.some(
      (workspace) =>
        workspace.pinned ||
        workspace.renamed ||
        workspace.hasComment ||
        workspace.createdInSeal ||
        workspace.inUse
    )
  if (touched) {
    return 'adopt'
  }
  const left =
    facts.machineRead &&
    facts.runningSessions === 0 &&
    facts.emptySince !== null &&
    now - facts.emptySince >= AUTO_CREATED_GRACE_MS
  return left ? 'remove' : 'keep'
}

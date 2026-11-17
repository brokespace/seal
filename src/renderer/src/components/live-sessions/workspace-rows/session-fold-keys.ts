/** Session folds sit in `collapsedGroups` beside the project folds, under the prefix they were first saved with. */
export const SESSION_FOLD_KEY_PREFIX = 'active-agents:'

/** Unlike a project group's key, a session fold's means the same under every Projects grouping. */
export function isSessionFoldKey(key: string): boolean {
  return key.startsWith(SESSION_FOLD_KEY_PREFIX)
}

/** A group of sessions no workspace card holds: a project's own (`header:<key>`, `project:<name>`) or the ones with no folder. */
export const UNASSIGNED_SESSION_GROUP = 'unassigned'

/** Present while that group is folded. A project's own sessions under its header fold with the header instead. */
export function sessionGroupCollapseKey(group: string): string {
  return `${SESSION_FOLD_KEY_PREFIX}${group}`
}

/** Present while that group's ended sessions are unfolded: they start folded away. */
export function sessionGroupFinishedOpenKey(group: string): string {
  return group === UNASSIGNED_SESSION_GROUP
    ? `${SESSION_FOLD_KEY_PREFIX}finished-open`
    : `${SESSION_FOLD_KEY_PREFIX}finished-open:${group}`
}

/** Session folds sit in `collapsedGroups` beside the project folds, under the prefix they were first saved with. */
export const SESSION_FOLD_KEY_PREFIX = 'active-agents:'

/** Unlike a project group's key, a session fold's means the same under every Projects grouping. */
export function isSessionFoldKey(key: string): boolean {
  return key.startsWith(SESSION_FOLD_KEY_PREFIX)
}

/** Present while the Unassigned group is folded. */
export const UNASSIGNED_SESSIONS_COLLAPSE_KEY = `${SESSION_FOLD_KEY_PREFIX}unassigned`

/** Present while the Unassigned group's ended sessions are unfolded: they start folded away. */
export const UNASSIGNED_FINISHED_OPEN_KEY = `${SESSION_FOLD_KEY_PREFIX}finished-open`

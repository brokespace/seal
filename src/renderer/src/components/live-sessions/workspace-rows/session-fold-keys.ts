/** Session folds sit in `collapsedGroups` beside the project folds, under the prefix they were first saved with. */
export const SESSION_FOLD_KEY_PREFIX = 'active-agents:'

/** Unlike a project group's key, a session fold's means the same under every Projects grouping. */
export function isSessionFoldKey(key: string): boolean {
  return key.startsWith(SESSION_FOLD_KEY_PREFIX)
}

/** The sessions under one header: a project's own (`header:<key>`, `project:<name>`) or the ones with no folder. */
export const UNASSIGNED_SESSION_GROUP = 'unassigned'

/** The key of the header the sessions bring for such a group, which also folds it. A project of the list keeps its own. */
export function sessionsHeaderKey(group: string): string {
  return `${SESSION_FOLD_KEY_PREFIX}${group}`
}

/** The group of the sessions under a header: its own for one they brought, `header:<key>` under a project of the list. */
export function headerSessionGroup(headerKey: string): string {
  return isSessionFoldKey(headerKey)
    ? headerKey.slice(SESSION_FOLD_KEY_PREFIX.length)
    : `header:${headerKey}`
}

/** Present while that group's ended sessions are unfolded: they start folded away. */
export function sessionGroupFinishedOpenKey(group: string): string {
  return group === UNASSIGNED_SESSION_GROUP
    ? `${SESSION_FOLD_KEY_PREFIX}finished-open`
    : `${SESSION_FOLD_KEY_PREFIX}finished-open:${group}`
}

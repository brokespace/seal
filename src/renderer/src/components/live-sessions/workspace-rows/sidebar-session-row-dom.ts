/** The sidebar list's scroll container: the workspace cards and, after them, the Unassigned group. */
export const SIDEBAR_LIST = '[data-worktree-sidebar]'

/** Marks the Unassigned group. With no workspace at all there is no sidebar list around it. */
export const UNASSIGNED_SESSIONS_PROPS = { 'data-unassigned-sessions': '' }
export const UNASSIGNED_SESSIONS = '[data-unassigned-sessions]'

/** Marks the label that folds the Unassigned group. */
export const UNASSIGNED_SESSIONS_TOGGLE_PROPS = { 'data-unassigned-sessions-toggle': '' }
export const UNASSIGNED_SESSIONS_TOGGLE = '[data-unassigned-sessions-toggle]'

/** Every session row the sidebar shows, under a workspace or unassigned. */
export const SIDEBAR_SESSION_ROW = `:is(${SIDEBAR_LIST}, ${UNASSIGNED_SESSIONS}) [data-live-session-row]`

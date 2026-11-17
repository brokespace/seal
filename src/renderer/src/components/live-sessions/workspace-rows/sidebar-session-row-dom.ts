/** The sidebar list's scroll container: the workspace cards and, after them, the projects no card stands for. */
export const SIDEBAR_LIST = '[data-worktree-sidebar]'

/**
 * Marks sessions no workspace card holds: a project's own under its header, a project the list
 * has no header for, the ones with no folder. With no workspace at all there is no sidebar list
 * around the last two.
 */
export const SESSION_GROUP_ATTRIBUTE = 'data-session-group'
export const SESSION_GROUP = `[${SESSION_GROUP_ATTRIBUTE}]`

/** Marks the label that folds such a group. */
export const SESSION_GROUP_TOGGLE_PROPS = { 'data-session-group-toggle': '' }
export const SESSION_GROUP_TOGGLE = '[data-session-group-toggle]'

/** Every session row the sidebar shows, on a workspace's card or in a group. */
export const SIDEBAR_SESSION_ROW = `:is(${SIDEBAR_LIST}, ${SESSION_GROUP}) [data-live-session-row]`

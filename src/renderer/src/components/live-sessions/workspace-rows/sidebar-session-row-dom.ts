/** The sidebar list's scroll container: the workspace cards and the sessions no card holds. */
export const SIDEBAR_LIST = '[data-worktree-sidebar]'

/** Marks the sessions no workspace card holds, under their header in the list. */
export const SESSION_GROUP_ATTRIBUTE = 'data-session-group'
export const SESSION_GROUP = `[${SESSION_GROUP_ATTRIBUTE}]`

/** Every session row the sidebar shows, on a workspace's card or under a header. */
export const SIDEBAR_SESSION_ROW = `${SIDEBAR_LIST} [data-live-session-row]`

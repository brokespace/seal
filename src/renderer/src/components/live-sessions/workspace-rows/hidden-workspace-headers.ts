const NO_HEADERS: ReadonlyMap<string, string> = new Map()

let headers = NO_HEADERS

/** While workspaces are hidden: the header whose sessions row lists each workspace's sessions, folded or not. */
export function setHiddenWorkspaceHeaders(next: ReadonlyMap<string, string> | null): void {
  headers = next ?? NO_HEADERS
}

/** Null while workspaces are shown, or for a workspace no header holds. */
export function hiddenWorkspaceHeader(worktreeId: string): string | null {
  return headers.get(worktreeId) ?? null
}

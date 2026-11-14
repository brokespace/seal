// Reopening the page returns to the session last picked there or opened from another surface (Home).
let lastSelectedLiveSessionId: string | null = null

export function getLastSelectedLiveSessionId(): string | null {
  return lastSelectedLiveSessionId
}

export function rememberLiveSessionSelection(sessionId: string): void {
  lastSelectedLiveSessionId = sessionId
}

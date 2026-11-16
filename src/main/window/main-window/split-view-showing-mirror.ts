import { ipcMain, type WebContents } from 'electron'

const renderersShowingSplitView = new WeakSet<WebContents>()
let listening = false

/** Main resolves shortcuts before a renderer keydown exists, so each renderer reports whether its main area is the grid. */
export function installSplitViewShowingMirror(): void {
  if (listening) {
    return
  }
  listening = true
  // Keyed by sender, so an embedded page or another window can only speak for itself.
  ipcMain.on('ui:setSplitViewShowing', (event, showing: unknown) => {
    if (showing === true) {
      renderersShowingSplitView.add(event.sender)
    } else {
      renderersShowingSplitView.delete(event.sender)
    }
  })
}

export function isSplitViewShowingIn(renderer: WebContents | null): boolean {
  return renderer !== null && renderersShowingSplitView.has(renderer)
}

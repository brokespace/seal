import type React from 'react'

/** Starts a side sheet below the Windows/Linux window buttons, which would otherwise sit on its close button. */
export const AGENT_CONFIG_SHEET_BELOW_WINDOW_CONTROLS: React.CSSProperties = {
  top: 'var(--window-controls-height, 0px)',
  height: 'auto'
}

import { createContext } from 'react'

/**
 * False inside a project that stays mounted behind another tab. What it opened by
 * pointing is drawn outside it, and the pointer cannot leave a row that is no longer on screen.
 */
export const ItemSurfaceShownContext = createContext(true)

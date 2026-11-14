/**
 * User-visible product name. Seal is a fork of Orca; internal identifiers keep upstream's names.
 * Must match package.json `productName`: Electron names the userData folder after it, which keeps
 * Seal's profile apart from an installed Orca's `orca` folder.
 */
export const APP_PRODUCT_NAME = 'Seal'

export type AppIdentity = {
  name: string
  isDev: boolean
  devLabel: string | null
  devBranch: string | null
  devWorktreeName: string | null
  devRepoRoot: string | null
  dockBadgeLabel: string | null
}

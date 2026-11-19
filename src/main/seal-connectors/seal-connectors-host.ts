import type {
  SealConnectorsConfig,
  SignInSecret
} from '../../shared/seal-connectors/seal-connectors-types'

/** This host's view of Seal's central list and sign-ins; launch code reads it, sync writes it. */
export type SealConnectorsHost = {
  /** `host:<installation id>`; null until read. */
  hostKey(): string | null
  /** Every key this host answers to in scopes, its `host:` key first. */
  machineKeys(): string[]
  config(): SealConnectorsConfig
  /** The newest secret this host holds for a sign-in; null when it has none. */
  signIn(id: string): SignInSecret | null
  /** Resolves once the list is loaded and this host's own MCP servers were adopted into it. */
  ready(): Promise<void>
  onChange(listener: () => void): () => void
  /** Plugin folders of this host's Seal plugin library, by plugin id; absent until fetched. */
  pluginDir(pluginId: string): string | null
  /** Folder of the generated plugin holding library skills, when any exist. */
  librarySkillsDir(): string | null
  /** Applies an edit, dates it, saves it and lets the desktop carry it to the fleet. */
  editConfig(edit: (config: SealConnectorsConfig) => SealConnectorsConfig): SealConnectorsConfig
  /** Stores a sign-in secret sealed; the newest `updatedAt` wins. */
  saveSignIn(secret: SignInSecret): void
  removeSignIn(id: string): void
  /** Marks an OAuth sign-in as refused by its server (status only). */
  markNeedsReconnect(id: string, value: boolean): void
  needsReconnect(id: string): boolean
}

let installed: SealConnectorsHost | null = null

export function setSealConnectorsHost(host: SealConnectorsHost | null): void {
  installed = host
}

export function getSealConnectorsHost(): SealConnectorsHost | null {
  return installed
}

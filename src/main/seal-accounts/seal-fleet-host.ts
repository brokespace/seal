import {
  sealHostMachineKey,
  type SealAccountsConfig
} from '../../shared/seal-accounts/seal-accounts-config'
import { readStoreInstallationId } from '../runtime/hosts/platform-probe/host-descriptor'
import { getCanonicalUserDataPath } from '../persistence/loading-store/user-data-path'

/** What `applyFleetConfig` did: the newer config wins, so a host can hand back its own. */
export type SealFleetConfigApplied = {
  applied: boolean
  config: SealAccountsConfig
  hostKey: string | null
}

/** The fleet's config when it is newer than this host's; API keys stay with the host that sealed them. */
export function newerFleetConfig(
  current: SealAccountsConfig,
  offered: SealAccountsConfig
): SealAccountsConfig | null {
  return offered.updatedAt > current.updatedAt ? { ...offered, apiKeys: current.apiKeys } : null
}

/** This host's place in the Seal fleet: the keys machine rules name it by, and its config edits. */
export class SealFleetHost {
  private key: string | null = null
  private readonly saved = new Set<() => void>()

  /** `legacyKey` is the name an older desktop gave this host (`local` or `runtime:<id>`). */
  constructor(private readonly legacyKey: () => string) {}

  load(
    installationId: () => Promise<string | undefined> = () =>
      readStoreInstallationId(null, getCanonicalUserDataPath())
  ): void {
    void installationId()
      .then((id) => {
        this.key = id ? sealHostMachineKey(id) : null
      })
      .catch((error: unknown) => {
        console.warn('[seal-accounts] This host has no installation id for machine rules:', error)
      })
  }

  /** `host:<installation id>`, the same on every desktop; null until the id is read. */
  get hostKey(): string | null {
    return this.key
  }

  /** Every machine rule key that names this host, the stable one first. */
  machineKeys(): string[] {
    return [...new Set([this.key, this.legacyKey()].filter((key) => key !== null))]
  }

  /** Called after each edit made on this host, so a desktop can carry it to the fleet. */
  onConfigSaved(listener: () => void): () => void {
    this.saved.add(listener)
    return () => this.saved.delete(listener)
  }

  configSaved(): void {
    for (const listener of this.saved) {
      listener()
    }
  }
}

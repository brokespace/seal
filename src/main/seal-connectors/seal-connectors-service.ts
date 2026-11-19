import { join } from 'node:path'
import {
  referencedSignInIds,
  withoutSignIn
} from '../../shared/seal-connectors/seal-connectors-config-edits'
import {
  mergeSealConnectorsConfigs,
  sealConnectorsConfigKey,
  signInRemoved,
  stampSealConnectorsEdit
} from '../../shared/seal-connectors/seal-connectors-config-merge'
import { getAppEnvironment } from '../../shared/app-environment'
import {
  SealConnectorsConfigSchema,
  type RefresherLease,
  type SealConnectorsConfig,
  type SealConnectorsHostStatus,
  type SignInSecret
} from '../../shared/seal-connectors/seal-connectors-types'
import type { SealFleetHost } from '../seal-accounts/seal-fleet-host'
import type {
  SealConnectorsApplied,
  SealConnectorsHost,
  SealPluginLibrary,
  SealSignInVersions
} from './seal-connectors-host'
import { RefresherLeaseState } from './seal-connectors-lease'
import type { SealConnectorsRefresher } from './seal-connectors-refresher'
import { signInStates } from './seal-connectors-sign-in-records'
import { SealConnectorsStore } from './seal-connectors-store'

export type SealConnectorsServiceDeps = {
  host: Pick<SealFleetHost, 'hostKey' | 'machineKeys'>
  dataRoot?: string
  library?: SealPluginLibrary
  now?: () => number
}

function warn(message: string): (error: unknown) => void {
  return (error) => console.warn(message, error instanceof Error ? error.message : '')
}

/** One host's central connector list, sign-ins and refresher lease. */
export class SealConnectorsService implements SealConnectorsHost {
  private readonly store: SealConnectorsStore
  private readonly now: () => number
  readonly lease: RefresherLeaseState
  private readonly changed = new Set<() => void>()
  private readonly edited = new Set<() => void>()
  private ready_: Promise<void> = Promise.resolve()
  private relayPort: () => number | null = () => null
  refresher: SealConnectorsRefresher | null = null

  constructor(private readonly deps: SealConnectorsServiceDeps) {
    const dir = join(deps.dataRoot ?? getAppEnvironment().getPath('userData'), 'seal-connectors')
    this.store = new SealConnectorsStore(dir)
    this.now = deps.now ?? Date.now
    this.lease = new RefresherLeaseState(
      this.store.getRefresher().lease,
      { hostKey: () => this.hostKey(), now: this.now },
      (lease) => this.store.saveRefresher({ ...this.store.getRefresher(), lease })
    )
    this.pruneSignIns()
    this.reconcileLibrary()
  }

  /** Runs this host's one-time adoption of its own MCP servers; `ready()` waits for it. */
  begin(seed: () => Promise<void>): void {
    this.ready_ = seed().catch(warn('[seal-connectors] Could not adopt this host’s MCP servers:'))
  }

  hostKey(): string | null {
    return this.deps.host.hostKey
  }

  machineKeys(): string[] {
    return this.deps.host.machineKeys()
  }

  config(): SealConnectorsConfig {
    return this.store.getConfig()
  }

  signIn(id: string): SignInSecret | null {
    return this.store.signIn(id)
  }

  async ready(): Promise<void> {
    await this.ready_
    await this.deps.library?.loaded
  }

  onChange(listener: () => void): () => void {
    this.changed.add(listener)
    return () => this.changed.delete(listener)
  }

  /** Fires for edits made on this host (not ones the fleet delivered), so a desktop can carry them. */
  onLocalEdit(listener: () => void): () => void {
    this.edited.add(listener)
    return () => this.edited.delete(listener)
  }

  setRelayPortSource(source: () => number | null): void {
    this.relayPort = source
  }

  pluginDir(pluginId: string): string | null {
    return this.deps.library?.pluginDir(pluginId) ?? null
  }

  librarySkillsDir(): string | null {
    return this.deps.library?.librarySkillsDir() ?? null
  }

  private emitChange(): void {
    for (const listener of this.changed) {
      listener()
    }
  }

  private emitLocalEdit(): void {
    this.emitChange()
    for (const listener of this.edited) {
      listener()
    }
  }

  private reconcileLibrary(): void {
    void this.deps.library
      ?.reconcile(this.config())
      .catch(warn('[seal-connectors] Could not update the plugin library:'))
  }

  /** Deletes secrets of sign-ins someone removed; one the list has not caught up with yet stays. */
  private pruneSignIns(): void {
    const config = this.config()
    for (const id of this.store.sealedIds()) {
      if (signInRemoved(config, id) && !referencedSignInIds(config).has(id)) {
        this.store.removeSignIn(id)
      }
    }
    const refresher = this.store.getRefresher()
    const needsReconnect = refresher.needsReconnect.filter((id) => !signInRemoved(config, id))
    if (needsReconnect.length !== refresher.needsReconnect.length) {
      this.store.saveRefresher({ ...refresher, needsReconnect })
    }
  }

  editConfig(edit: (config: SealConnectorsConfig) => SealConnectorsConfig): SealConnectorsConfig {
    const current = this.config()
    const now = Math.max(this.now(), current.updatedAt + 1)
    const next = SealConnectorsConfigSchema.parse({
      ...stampSealConnectorsEdit(current, edit(current), now),
      updatedAt: now
    })
    this.store.saveConfig(next)
    this.pruneSignIns()
    this.reconcileLibrary()
    this.emitLocalEdit()
    return next
  }

  /**
   * An edit made against `base` (a copy the UI read earlier): only what it changed lands, so
   * items the fleet delivered since are neither reverted nor removed.
   */
  applyLocalEdit(base: SealConnectorsConfig, edited: SealConnectorsConfig): SealConnectorsConfig {
    const now = Math.max(this.now(), this.config().updatedAt + 1)
    const change = stampSealConnectorsEdit(base, edited, now)
    // Untouched items keep base's stamps, so the merge keeps the current copy of each of them.
    return this.editConfig((current) => mergeSealConnectorsConfigs(current, change))
  }

  /** Merges another machine's copy into this host's; the answer is the merged list. */
  applyConfig(offered: SealConnectorsConfig): SealConnectorsApplied {
    const merged = mergeSealConnectorsConfigs(this.config(), offered)
    const applied = sealConnectorsConfigKey(merged) !== sealConnectorsConfigKey(this.config())
    if (applied) {
      this.store.saveConfig(merged)
      this.pruneSignIns()
      this.reconcileLibrary()
      this.emitChange()
    }
    return { applied, config: this.config(), hostKey: this.hostKey() }
  }

  /** A sign-in made or renewed here replaces what this host held, whatever its clock says. */
  saveSignIn(secret: SignInSecret): void {
    const held = this.store.signIn(secret.id)
    this.store.saveSignIn({
      ...secret,
      updatedAt: Math.max(secret.updatedAt, (held?.updatedAt ?? 0) + 1)
    })
    this.setNeedsReconnect(secret.id, false)
    this.emitLocalEdit()
  }

  /** Sign-ins the fleet carried here; each is kept only when newer than this host's copy. */
  importSignIns(secrets: readonly SignInSecret[]): string[] {
    const imported: string[] = []
    for (const secret of secrets) {
      const held = this.store.signIn(secret.id)
      if (held && held.updatedAt >= secret.updatedAt) {
        continue
      }
      this.store.saveSignIn(secret)
      this.setNeedsReconnect(secret.id, false)
      imported.push(secret.id)
    }
    if (imported.length > 0) {
      this.emitChange()
    }
    return imported
  }

  exportSignIns(ids: readonly string[]): SignInSecret[] {
    return ids.flatMap((id) => this.store.signIn(id) ?? [])
  }

  removeSignIn(id: string): void {
    this.store.removeSignIn(id)
    this.setNeedsReconnect(id, false)
    this.emitChange()
  }

  private setNeedsReconnect(id: string, value: boolean): void {
    const state = this.store.getRefresher()
    if (state.needsReconnect.includes(id) === value) {
      return
    }
    this.store.saveRefresher({
      ...state,
      needsReconnect: value
        ? [...state.needsReconnect, id]
        : state.needsReconnect.filter((entry) => entry !== id)
    })
  }

  markNeedsReconnect(id: string, value: boolean): void {
    this.setNeedsReconnect(id, value)
    this.emitChange()
  }

  needsReconnect(id: string): boolean {
    return this.store.getRefresher().needsReconnect.includes(id)
  }

  /** Unlists a sign-in; every host then deletes its secret. */
  removeSignInFrom(connectorId: string, signInId: string): void {
    this.editConfig((config) => withoutSignIn(config, connectorId, signInId))
  }

  setDesignatedRefresher(hostKey: string | null): void {
    this.editConfig((config) => ({ ...config, refresher: { designatedHostKey: hostKey } }))
  }

  setLease(next: RefresherLease): boolean {
    const { accepted, moved } = this.lease.accept(next)
    if (moved) {
      this.emitChange()
    }
    return accepted
  }

  mayRefresh(): boolean {
    return this.lease.mayRefresh()
  }

  signInVersions(): SealSignInVersions {
    const versions: Record<string, number> = {}
    for (const id of referencedSignInIds(this.config())) {
      const secret = this.store.signIn(id)
      if (secret) {
        versions[id] = secret.updatedAt
      }
    }
    const lease = this.lease.current()
    return {
      hostKey: this.hostKey(),
      now: this.now(),
      versions,
      lease,
      heartbeatAt: this.lease.owns() ? lease.heartbeatAt : 0
    }
  }

  status(): SealConnectorsHostStatus {
    return {
      hostKey: this.hostKey(),
      config: this.config(),
      signIns: signInStates(this),
      lease: this.lease.current(),
      refreshing: this.mayRefresh(),
      relayPort: this.relayPort(),
      plugins: this.deps.library?.state() ?? []
    }
  }

  dispose(): void {
    this.refresher?.stop()
  }
}

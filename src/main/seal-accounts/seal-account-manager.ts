import { join } from 'node:path'
import { getAppEnvironment } from '../../shared/app-environment'
import type { Store } from '../persistence/loading-store/store'
import type { ProviderAccountServices } from '../providers/accounts/provider-account-services'
import {
  SEAL_PROVIDERS,
  type SealAccountKey,
  type SealAccountsConfig,
  type SealProvider
} from '../../shared/seal-accounts/seal-accounts-config'
import { newerFleetConfig, SealFleetHost, type SealFleetConfigApplied } from './seal-fleet-host'
import type { SealAccountCandidate } from '../../shared/seal-accounts/seal-account-candidates'
import { buildSealCandidates } from '../../shared/seal-accounts/seal-account-candidate-builder'
import { parseSealAccountKey } from '../../shared/seal-accounts/seal-account-key'
import {
  resolveSealPolicy,
  type ResolvedSealPolicy,
  type SealProjectIdentity
} from '../../shared/seal-accounts/seal-account-policy'
import { findCandidateByRef } from '../../shared/seal-accounts/seal-launch-account-pick'
import type {
  SealAccountsStatus,
  SealSwapEvent
} from '../../shared/seal-accounts/seal-accounts-status'
import {
  withAccountOrder,
  withWorkspacePin
} from '../../shared/seal-accounts/seal-accounts-config-edits'
import {
  onClaudeRefreshRejected,
  persistClaudeRefreshRejections
} from '../claude-accounts/runtime-auth/claude-refresh-rejections'
import { runSealAccountsMigration } from './seal-account-migration'
import { SealLoginExpiryCache } from './seal-login-expiry'
import { readSealSystemLogins } from './seal-system-login'
import { sealSystemLoginStatus } from './seal-system-login-listing'
import { recordSealHostSwap } from './seal-host-swap'
import { SealHostAutoSwap } from './seal-host-auto-swap'
import { createSealSignInFlows, type SealSignInFlows } from './seal-account-sign-in'
import { SealAccountsStore } from './seal-accounts-store'
import { SealApiKeyVault } from './seal-api-key-vault'
import type { SealUsageFetch, SealUsagePoller } from './seal-usage-poller'
import { sealUsageFetcher } from './seal-usage-fetch'
import { installSealLiveUsageOwner } from './seal-live-usage-owner'
import { createSealUsagePoller, sealAccountsInUse, withUsageSchedule } from './seal-usage-schedule'
import { startSealSessionWatch } from './seal-session-watch'

export type SealAccountManagerDeps = {
  store: Pick<Store, 'getRepo' | 'getSettings'>
  services: ProviderAccountServices
  dataRoot?: string
  now?: () => number
  fetchUsage?: SealUsageFetch
  /** This host's installation id, which names it in machine rules on every desktop. */
  installationId?: () => Promise<string | undefined>
}

/** One host's account brain: candidates, claude-swap auto-swap, and per-launch picks. */
export class SealAccountManager {
  readonly dataRoot: string
  readonly store: SealAccountsStore
  readonly vault: SealApiKeyVault
  readonly now: () => number
  readonly autoSwap = new SealHostAutoSwap(this)
  private readonly unsubscribe: (() => void)[] = []
  readonly usage: SealUsagePoller
  /** When an agent running on each account last printed a limit stop. */
  readonly limitStops = new Map<SealAccountKey, number>()
  readonly loginExpiry = new SealLoginExpiryCache()
  /** Resolves once saved accounts were merged into one list on this start. */
  migrated: Promise<void> = Promise.resolve()
  private signInFlows: SealSignInFlows | null = null
  readonly host = new SealFleetHost(() => this.machineKey)

  constructor(readonly deps: SealAccountManagerDeps) {
    this.dataRoot = deps.dataRoot ?? getAppEnvironment().getPath('userData')
    const dir = join(this.dataRoot, 'seal-accounts')
    this.store = new SealAccountsStore(dir)
    this.vault = new SealApiKeyVault(dir)
    this.now = deps.now ?? Date.now
    this.usage = createSealUsagePoller(this, deps.fetchUsage ?? sealUsageFetcher(deps.services))
    this.usage.onPolled(() => this.scheduleEvaluation())
  }

  get services(): ProviderAccountServices {
    return this.deps.services
  }

  start(): void {
    this.host.load(this.deps.installationId)
    persistClaudeRefreshRejections(join(this.dataRoot, 'seal-accounts', 'refused-logins.json'))
    this.unsubscribe.push(
      this.services.rateLimits.onStateChange(() => this.scheduleEvaluation()),
      this.loginExpiry.onChange(() => this.scheduleEvaluation()),
      onClaudeRefreshRejected(() => this.recheckLogins())
    )
    this.usage.sync()
    this.migrated = runSealAccountsMigration(this).catch((error: unknown) => {
      console.warn('[seal-accounts] Could not merge duplicate accounts:', error)
    })
  }

  dispose(): void {
    for (const unsubscribe of this.unsubscribe.splice(0)) {
      unsubscribe()
    }
    this.usage.dispose()
    this.autoSwap.dispose()
  }

  getConfig(): SealAccountsConfig {
    return this.store.getConfig()
  }

  get signIns(): SealSignInFlows {
    this.signInFlows ??= createSealSignInFlows(this)
    return this.signInFlows
  }

  get machineKey(): string {
    return this.store.getState().machineKey
  }

  /** Every account with the rate-limit service's reading, before the poll schedule and swap estimate. */
  baseCandidates(provider: SealProvider): SealAccountCandidate[] {
    return buildSealCandidates(
      {
        config: this.getConfig(),
        claude: this.services.claudeAccounts.listAccounts(),
        codex: this.services.codexAccounts.listAccounts(),
        rateLimits: this.services.rateLimits.getState(),
        storedApiKeyIds: this.vault.storedIds(),
        systemLogins: readSealSystemLogins(this.services),
        dismissedSystemLogins: this.store.getState().dismissedSystemLogins,
        loginExpiry: (key) => this.loginExpiry.get(key),
        now: this.now()
      },
      provider
    )
  }

  candidates(provider: SealProvider): SealAccountCandidate[] {
    return withUsageSchedule(this.baseCandidates(provider), {
      poller: this.usage,
      config: this.getConfig(),
      inUse: this.accountsInUse(provider),
      limitStopAt: (key) => this.limitStops.get(key) ?? null,
      now: this.now()
    })
  }

  accountsInUse(provider: SealProvider): Set<SealAccountKey> {
    const sessions = this.store.getState().sessions
    return sealAccountsInUse(provider, this.baseCandidates(provider), sessions, this.now())
  }

  policy(provider: SealProvider, project: SealProjectIdentity | null): ResolvedSealPolicy {
    return resolveSealPolicy(this.getConfig(), {
      provider,
      machineKeys: this.host.machineKeys(),
      project
    })
  }

  status(): SealAccountsStatus {
    const state = this.store.getState()
    const provider = (entry: SealProvider) => {
      const machine = this.policy(entry, null)
      return {
        candidates: this.candidates(entry),
        machineAllow: machine.allow,
        machineDefault: machine.defaultKey,
        lastDecision: this.autoSwap.lastDecision[entry]
      }
    }
    return {
      machineKey: state.machineKey,
      ...(this.host.hostKey ? { hostKey: this.host.hostKey } : {}),
      machineKeys: this.host.machineKeys(),
      config: this.getConfig(),
      providers: { claude: provider('claude'), codex: provider('codex') },
      quarantine: state.quarantine,
      swapLog: state.swapLog,
      sessions: state.sessions,
      workspacePins: state.workspacePins,
      fleetCopies: state.fleetCopies,
      systemLogins: sealSystemLoginStatus(this),
      migrationNotice: state.accountsMigration?.notice ?? null,
      secretStorage: {
        available: this.vault.isAvailable(),
        protectionGap: this.vault.protectionGap()
      }
    }
  }

  /** Sets priorities from a drag order: the first account is preferred. */
  reorder(provider: SealProvider, refs: readonly string[]): void {
    const keys = refs.map((ref) => this.resolveKey(ref, provider))
    this.saveConfig(withAccountOrder(this.getConfig(), keys))
  }

  /** Asks the rate-limit service for every account's usage; its budget keeps repeats off the wire. */
  async refreshUsage(): Promise<void> {
    await Promise.allSettled([
      this.services.rateLimits.refreshIfStale(),
      this.loginExpiry.refresh(this)
    ])
    await this.usage.readAll()
  }

  /** Re-reads every stored login now, e.g. after a refresh token was refused. */
  recheckLogins(olderThanMs?: number): void {
    this.loginExpiry.invalidate(olderThanMs)
    void this.loginExpiry.refresh(this)
  }

  private scheduleEvaluation(): void {
    this.autoSwap.schedule()
  }

  evaluate(
    provider: SealProvider,
    options: { force?: boolean } = {}
  ): Promise<SealSwapEvent | null> {
    return this.autoSwap.evaluate(provider, options)
  }

  swapTo(provider: SealProvider, ref: string): Promise<SealSwapEvent> {
    const candidate = this.requireCandidate(provider, ref)
    return recordSealHostSwap(this, provider, candidate, 'manual', (next) => {
      delete next.quarantine[candidate.key]
    })
  }

  requireCandidate(provider: SealProvider, ref: string): SealAccountCandidate {
    const candidate = findCandidateByRef(this.candidates(provider), ref)
    if (!candidate) {
      throw new Error(`No ${provider} account matches "${ref}".`)
    }
    return candidate
  }

  /** Accepts a ref for either provider: a key, alias, email, or this host's account id. */
  resolveKey(ref: string, provider?: SealProvider): SealAccountKey {
    for (const entry of provider ? [provider] : SEAL_PROVIDERS) {
      const candidate = findCandidateByRef(this.candidates(entry), ref)
      if (candidate) {
        return candidate.key
      }
    }
    const parsed = parseSealAccountKey(ref)
    if (parsed && (!provider || parsed.provider === provider)) {
      return ref
    }
    throw new Error(`No account matches "${ref}".`)
  }

  saveConfig(config: SealAccountsConfig): void {
    this.store.saveConfig({ ...config, updatedAt: this.now() })
    this.usage.sync()
    this.scheduleEvaluation()
    this.host.configSaved()
  }

  /**
   * Every Seal host keeps the fleet's config; the newest edit wins wherever it was made. API keys
   * never travel with it: each host keeps the ones sealed in its own keychain.
   */
  applyFleetConfig(config: SealAccountsConfig, machineKey?: string): SealFleetConfigApplied {
    const newer = newerFleetConfig(this.getConfig(), config)
    if (machineKey && machineKey !== this.machineKey) {
      // Older desktops still name hosts by their own server id; rules saved that way keep matching.
      this.store.updateState((next) => {
        next.machineKey = machineKey
      })
    }
    if (newer) {
      this.store.saveConfig(newer)
      this.usage.sync()
      this.scheduleEvaluation()
    }
    const shared = { ...this.getConfig(), apiKeys: [] }
    return { applied: newer !== null, config: shared, hostKey: this.host.hostKey }
  }

  pinWorkspace(worktreeId: string, provider: SealProvider, ref: string | null): void {
    const key = ref === null ? null : this.resolveKey(ref, provider)
    this.store.updateState((next) => {
      next.workspacePins = withWorkspacePin(next.workspacePins, worktreeId, provider, key)
    })
  }

  codexHome(accountId: string): string | null {
    const accounts = this.deps.store.getSettings().codexManagedAccounts
    return accounts.find((account) => account.id === accountId)?.managedHomePath ?? null
  }
}

let installed: SealAccountManager | null = null

/** Every runtime (desktop and each remote orcad) runs its own manager over its own logins. */
export function installSealAccountManager(deps: SealAccountManagerDeps): SealAccountManager {
  installed?.dispose()
  installed = new SealAccountManager(deps)
  installed.start()
  installSealLiveUsageOwner(installed)
  startSealSessionWatch(installed)
  return installed
}

export function getSealAccountManager(): SealAccountManager | null {
  return installed
}

export function requireSealAccountManager(): SealAccountManager {
  if (!installed) {
    throw new Error('Seal accounts are not available in this runtime.')
  }
  return installed
}

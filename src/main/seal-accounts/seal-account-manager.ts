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
import type { SealAccountCandidate } from '../../shared/seal-accounts/seal-account-candidates'
import { buildSealCandidates } from '../../shared/seal-accounts/seal-account-candidate-builder'
import { parseSealAccountKey } from '../../shared/seal-accounts/seal-account-key'
import {
  resolveSealPolicy,
  type ResolvedSealPolicy,
  type SealProjectIdentity
} from '../../shared/seal-accounts/seal-account-policy'
import {
  decideAutoSwap,
  describeAutoSwapDecision
} from '../../shared/seal-accounts/seal-auto-swap-decision'
import { findCandidateByRef } from '../../shared/seal-accounts/seal-launch-account-pick'
import type {
  SealAccountsStatus,
  SealSwapEvent
} from '../../shared/seal-accounts/seal-accounts-status'
import {
  withAccountOrder,
  withWorkspacePin
} from '../../shared/seal-accounts/seal-accounts-config-edits'
import { runSealAccountsMigration } from './seal-account-migration'
import { SealLoginExpiryCache } from './seal-login-expiry'
import { readSealSystemLogins } from './seal-system-login'
import { sealSystemLoginStatus } from './seal-system-login-listing'
import { recordSealHostSwap, type SealSwapQuarantineUpdate } from './seal-host-swap'
import { createSealSignInFlows, type SealSignInFlows } from './seal-account-sign-in'
import { SealAccountsStore } from './seal-accounts-store'
import { SealApiKeyVault } from './seal-api-key-vault'
import type { SealUsageFetch, SealUsagePoller } from './seal-usage-poller'
import { sealUsageFetcher } from './seal-usage-fetch'
import { createSealUsagePoller, sealAccountsInUse, withUsageSchedule } from './seal-usage-schedule'
import { startSealSessionWatch } from './seal-session-watch'

const EVALUATE_DEBOUNCE_MS = 2_000

export type SealAccountManagerDeps = {
  store: Pick<Store, 'getRepo' | 'getSettings'>
  services: ProviderAccountServices
  dataRoot?: string
  now?: () => number
  fetchUsage?: SealUsageFetch
}

/** One host's account brain: candidates, claude-swap auto-swap, and per-launch picks. */
export class SealAccountManager {
  readonly dataRoot: string
  readonly store: SealAccountsStore
  readonly vault: SealApiKeyVault
  readonly now: () => number
  private readonly lastDecision: Record<SealProvider, { at: number; summary: string } | null> = {
    claude: null,
    codex: null
  }
  private unsubscribeUsage: (() => void) | null = null
  readonly usage: SealUsagePoller
  /** When an agent running on each account last printed a limit stop. */
  readonly limitStops = new Map<SealAccountKey, number>()
  private evaluateTimer: ReturnType<typeof setTimeout> | null = null
  private evaluating: Promise<unknown> = Promise.resolve()
  readonly loginExpiry = new SealLoginExpiryCache()
  /** Resolves once saved accounts were merged into one list on this start. */
  migrated: Promise<void> = Promise.resolve()
  private signInFlows: SealSignInFlows | null = null

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
    this.unsubscribeUsage = this.services.rateLimits.onStateChange(() => this.scheduleEvaluation())
    this.usage.sync()
    this.migrated = runSealAccountsMigration(this).catch((error: unknown) => {
      console.warn('[seal-accounts] Could not merge duplicate accounts:', error)
    })
  }

  dispose(): void {
    this.unsubscribeUsage?.()
    this.usage.dispose()
    clearTimeout(this.evaluateTimer ?? undefined)
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
    return resolveSealPolicy(this.getConfig(), { provider, machineKey: this.machineKey, project })
  }

  status(): SealAccountsStatus {
    const state = this.store.getState()
    const provider = (entry: SealProvider) => {
      const machine = this.policy(entry, null)
      return {
        candidates: this.candidates(entry),
        machineAllow: machine.allow,
        machineDefault: machine.defaultKey,
        lastDecision: this.lastDecision[entry]
      }
    }
    return {
      machineKey: state.machineKey,
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

  async refreshUsage(): Promise<void> {
    const { rateLimits } = this.services
    await Promise.allSettled([
      rateLimits.refreshIfStale(),
      rateLimits.fetchInactiveClaudeAccountsOnOpen(),
      rateLimits.fetchInactiveCodexAccountsOnOpen(),
      this.loginExpiry.refresh(this)
    ])
    // After the service's own pass, so an account it just read is not requested twice.
    await this.usage.refreshNow()
  }

  private anyAutoSwapEnabled(): boolean {
    return SEAL_PROVIDERS.some((provider) => this.getConfig().autoSwap[provider].enabled)
  }

  private scheduleEvaluation(): void {
    if (!this.anyAutoSwapEnabled() || this.evaluateTimer) {
      return
    }
    this.evaluateTimer = setTimeout(() => {
      this.evaluateTimer = null
      for (const provider of SEAL_PROVIDERS) {
        void this.evaluate(provider).catch((error: unknown) => {
          console.warn(`[seal-accounts] ${provider} auto-swap check failed:`, error)
        })
      }
    }, EVALUATE_DEBOUNCE_MS)
    this.evaluateTimer.unref?.()
  }

  /** One claude-swap pass. Only the host selection moves, so running sessions keep their login. */
  evaluate(
    provider: SealProvider,
    options: { force?: boolean } = {}
  ): Promise<SealSwapEvent | null> {
    const run = this.evaluating.then(async () => {
      const config = this.getConfig()
      const state = this.store.getState()
      const settings = config.autoSwap[provider]
      const decision = decideAutoSwap({
        settings: options.force ? { ...settings, enabled: true } : settings,
        candidates: this.candidates(provider),
        policy: this.policy(provider, null),
        quarantine: state.quarantine,
        lastSwapAt: options.force ? null : (state.lastSwapAt[provider] ?? null),
        now: this.now()
      })
      this.lastDecision[provider] = { at: this.now(), summary: describeAutoSwapDecision(decision) }
      if (decision.kind !== 'swap') {
        return null
      }
      return this.recordSwap(provider, decision.to, decision.reason, (next, at) => {
        for (const key of decision.quarantine) {
          next.quarantine[key] = {
            until: at + settings.quarantineMinutes * 60_000,
            reason: 'Login stopped working'
          }
        }
      })
    })
    this.evaluating = run.catch(() => {})
    return run
  }

  swapTo(provider: SealProvider, ref: string): Promise<SealSwapEvent> {
    const candidate = this.requireCandidate(provider, ref)
    return this.recordSwap(provider, candidate, 'manual', (next) => {
      delete next.quarantine[candidate.key]
    })
  }

  private recordSwap(
    provider: SealProvider,
    to: SealAccountCandidate,
    reason: SealSwapEvent['reason'],
    updateQuarantine: SealSwapQuarantineUpdate
  ): Promise<SealSwapEvent> {
    return recordSealHostSwap(this, provider, to, reason, updateQuarantine)
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
  }

  applyFleetConfig(config: SealAccountsConfig, machineKey: string): void {
    // API keys never travel with the config; each host keeps the ones sealed in its own keychain.
    this.store.saveConfig({ ...config, apiKeys: this.getConfig().apiKeys })
    this.store.updateState((next) => {
      next.machineKey = machineKey
    })
    this.usage.sync()
    this.scheduleEvaluation()
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

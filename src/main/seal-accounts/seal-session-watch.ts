import { SEAL_PROVIDERS } from '../../shared/seal-accounts/seal-accounts-config'
import {
  decideSessionSwap,
  isRateLimitStop
} from '../../shared/seal-accounts/seal-session-swap-decision'
import type { SealAccountManager } from './seal-account-manager'
import { reconcileFleetCredentials } from './seal-fleet-credentials'
import { sealFleetTransport } from './seal-fleet-sync'
import { loginIsCopied, reconcileClaudeLogin, reconcileCodexLogin } from './seal-login-copies'
import { removeSessionHome } from './seal-session-homes'
import { swapSealSession } from './seal-session-swap'
import { sealSessionTerminal, type SealAgentStatusRow } from './seal-session-terminal'
import { isLiveSealSession, SEAL_SESSION_TICK_MS } from './seal-usage-schedule'

const TICK_MS = SEAL_SESSION_TICK_MS
const USAGE_DEBOUNCE_MS = 3_000
const LOGIN_UPKEEP_MS = 5 * 60_000
// A pane must stay gone this long before its session home goes; a brief detach keeps it.
const SESSION_HOME_GRACE_MS = 24 * 60 * 60_000
const SPAWN_GRACE_MS = 2 * 60_000

/**
 * The running-session half of auto-swap: after every usage poll (and once a minute) it checks each
 * open session's own account against its 5h/7d lines and dead logins, moves that session alone,
 * keeps its login copies fresh, and cleans up after it closes. A printed limit stop is only a
 * last-resort fallback. Runs on every host (desktop and each remote runtime) for its own panes.
 */
export class SealSessionWatch {
  private timer: ReturnType<typeof setTimeout> | null = null
  private running: Promise<void> | null = null
  private lastUpkeep = 0
  private disposed = false
  private readonly unsubscribe: (() => void)[]

  constructor(private readonly manager: SealAccountManager) {
    const soon = () => this.schedule(USAGE_DEBOUNCE_MS)
    this.unsubscribe = [
      manager.services.rateLimits.onStateChange(soon),
      manager.usage.onPolled(soon)
    ]
    this.schedule(TICK_MS)
  }

  dispose(): void {
    this.disposed = true
    for (const unsubscribe of this.unsubscribe) {
      unsubscribe()
    }
    clearTimeout(this.timer ?? undefined)
  }

  private schedule(delayMs: number): void {
    if (this.disposed) {
      return
    }
    clearTimeout(this.timer ?? undefined)
    this.timer = setTimeout(() => {
      this.timer = null
      void this.tick().finally(() => this.schedule(TICK_MS))
    }, delayMs)
    this.timer.unref?.()
  }

  tick(): Promise<void> {
    this.running ??= this.runTick()
      .catch((error: unknown) => console.warn('[seal-accounts] Session check failed:', error))
      .finally(() => {
        this.running = null
      })
    return this.running
  }

  private async runTick(): Promise<void> {
    this.manager.usage.sync()
    const terminal = sealSessionTerminal()
    if (terminal) {
      await this.trackPanes(terminal.handleForPane.bind(terminal))
      await this.evaluate(terminal.statusRows())
    }
    const now = this.manager.now()
    if (now - this.lastUpkeep >= LOGIN_UPKEEP_MS) {
      this.lastUpkeep = now
      await this.upkeepLogins()
    }
  }

  private async trackPanes(handleForPane: (paneKey: string) => string | null): Promise<void> {
    const now = this.manager.now()
    const removals: string[] = []
    this.manager.store.updateState((next) => {
      for (const session of next.sessions) {
        if (!session.paneKey) {
          continue
        }
        if (handleForPane(session.paneKey)) {
          session.lastSeenAt = now
          session.endedAt = null
        } else if (!session.endedAt && now - session.at > SPAWN_GRACE_MS) {
          session.endedAt = now
        }
        if (
          session.endedAt &&
          session.profileHome &&
          now - session.endedAt > SESSION_HOME_GRACE_MS
        ) {
          removals.push(session.profileHome)
          session.profileHome = null
        }
      }
    })
    for (const home of removals) {
      await removeSessionHome(this.manager.dataRoot, home).catch((error: unknown) =>
        console.warn('[seal-accounts] Could not remove a closed session’s folder:', error)
      )
    }
  }

  private async evaluate(rows: readonly SealAgentStatusRow[]): Promise<void> {
    const state = this.manager.store.getState()
    const now = this.manager.now()
    for (const session of state.sessions.filter((entry) => isLiveSealSession(entry, now))) {
      const settings = this.manager.getConfig().autoSwap[session.provider]
      const row = session.paneKey ? rows.find((entry) => entry.paneKey === session.paneKey) : null
      // Last-resort fallback only; polled usage decides first (decideSessionSwap).
      const rateLimited =
        !!row &&
        row.state !== 'working' &&
        row.receivedAt > (session.lastSwapAt ?? 0) &&
        isRateLimitStop(row.lastAssistantMessage)
      if (rateLimited && session.accountKey) {
        this.manager.limitStops.set(session.accountKey, row.receivedAt)
      }
      const providerSessionId = row?.providerSession?.id ?? null
      const decision = decideSessionSwap({
        session: {
          accountKey: session.accountKey,
          liveSwap: session.liveSwap,
          lastSwapAt: session.lastSwapAt ?? null,
          rateLimited
        },
        capability: {
          provider: session.provider,
          isolatedHome: Boolean(session.profileHome),
          resumable: Boolean(providerSessionId && session.paneKey)
        },
        settings,
        candidates: this.manager.candidates(session.provider),
        policy: this.manager.policy(session.provider, null),
        quarantine: this.manager.store.getState().quarantine,
        now: this.manager.now()
      })
      if (decision.kind !== 'swap') {
        continue
      }
      this.manager.store.updateState((next) => {
        for (const key of decision.quarantine) {
          next.quarantine[key] = {
            until: this.manager.now() + settings.quarantineMinutes * 60_000,
            reason: 'Login stopped working'
          }
        }
      })
      await swapSealSession(this.manager, {
        sessionId: session.id,
        to: decision.to,
        reason: decision.reason,
        providerSessionId,
        continueAfter: decision.reason === 'rate-limit'
      })
    }
  }

  /** Keeps each shared login's copies (account home, session homes, other machines) on one token. */
  private async upkeepLogins(): Promise<void> {
    const sessions = this.manager.store.getState().sessions
    for (const provider of SEAL_PROVIDERS) {
      for (const candidate of this.manager.candidates(provider)) {
        if (candidate.kind !== 'oauth' || !candidate.localId) {
          continue
        }
        const shared =
          loginIsCopied(this.manager, candidate.key) ||
          sessions.some((session) => session.profileHome && session.accountKey === candidate.key)
        if (!shared) {
          continue
        }
        const args = { accountId: candidate.localId, accountKey: candidate.key }
        await (
          provider === 'claude'
            ? reconcileClaudeLogin(this.manager, args)
            : reconcileCodexLogin(this.manager, args)
        ).catch((error: unknown) =>
          console.warn(`[seal-accounts] Could not reconcile ${candidate.label}:`, error)
        )
      }
    }
    const transport = sealFleetTransport()
    if (transport) {
      const report = await reconcileFleetCredentials(this.manager, transport)
      for (const entry of [...report.pulled, ...report.pushed]) {
        console.log(`[seal-accounts] Synced the ${entry.account} login with ${entry.environmentId}`)
      }
    }
  }
}

let watch: SealSessionWatch | null = null

export function startSealSessionWatch(manager: SealAccountManager): SealSessionWatch {
  watch?.dispose()
  watch = new SealSessionWatch(manager)
  return watch
}

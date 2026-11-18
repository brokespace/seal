import { SEAL_PROVIDERS, type SealProvider } from '../../shared/seal-accounts/seal-accounts-config'
import {
  decideAutoSwap,
  describeAutoSwapDecision
} from '../../shared/seal-accounts/seal-auto-swap-decision'
import type { SealSwapEvent } from '../../shared/seal-accounts/seal-accounts-status'
import type { SealAccountManager } from './seal-account-manager'
import { recordSealHostSwap } from './seal-host-swap'

const EVALUATE_DEBOUNCE_MS = 2_000

/** claude-swap on one host: after usage moves, checks whether its selected account should change. */
export class SealHostAutoSwap {
  readonly lastDecision: Record<SealProvider, { at: number; summary: string } | null> = {
    claude: null,
    codex: null
  }
  private timer: ReturnType<typeof setTimeout> | null = null
  private running: Promise<unknown> = Promise.resolve()

  constructor(private readonly manager: SealAccountManager) {}

  schedule(): void {
    const config = this.manager.getConfig()
    if (!SEAL_PROVIDERS.some((provider) => config.autoSwap[provider].enabled) || this.timer) {
      return
    }
    this.timer = setTimeout(() => {
      this.timer = null
      for (const provider of SEAL_PROVIDERS) {
        void this.evaluate(provider).catch((error: unknown) => {
          console.warn(`[seal-accounts] ${provider} auto-swap check failed:`, error)
        })
      }
    }, EVALUATE_DEBOUNCE_MS)
    this.timer.unref?.()
  }

  /** One claude-swap pass. Only the host selection moves, so running sessions keep their login. */
  evaluate(
    provider: SealProvider,
    options: { force?: boolean } = {}
  ): Promise<SealSwapEvent | null> {
    const manager = this.manager
    const run = this.running.then(async () => {
      const config = manager.getConfig()
      const state = manager.store.getState()
      const settings = config.autoSwap[provider]
      const decision = decideAutoSwap({
        settings: options.force ? { ...settings, enabled: true } : settings,
        candidates: manager.candidates(provider),
        policy: manager.policy(provider, null),
        quarantine: state.quarantine,
        lastSwapAt: options.force ? null : (state.lastSwapAt[provider] ?? null),
        now: manager.now()
      })
      this.lastDecision[provider] = {
        at: manager.now(),
        summary: describeAutoSwapDecision(decision)
      }
      if (decision.kind !== 'swap') {
        return null
      }
      return recordSealHostSwap(manager, provider, decision.to, decision.reason, (next, at) => {
        for (const key of decision.quarantine) {
          next.quarantine[key] = {
            until: at + settings.quarantineMinutes * 60_000,
            reason: 'Login stopped working'
          }
        }
      })
    })
    this.running = run.catch(() => {})
    return run
  }

  dispose(): void {
    clearTimeout(this.timer ?? undefined)
  }
}

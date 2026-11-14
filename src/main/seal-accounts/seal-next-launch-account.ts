import type { SealAccountKey, SealProvider } from '../../shared/seal-accounts/seal-accounts-config'
import { getRepoIdFromWorktreeId } from '../../shared/worktree/id'

// Why: a worktree is created (and may run setup) between the choice and the agent's spawn.
const CHOICE_TTL_MS = 10 * 60_000

/**
 * The account a user chose for the next agent session in a project. It is keyed by project
 * because the session's worktree may not exist yet, and it is spent by the first matching launch.
 */
export class SealNextLaunchAccounts {
  private readonly choices = new Map<string, { key: SealAccountKey; expiresAt: number }>()

  constructor(private readonly now: () => number) {}

  set(repoId: string, provider: SealProvider, key: SealAccountKey | null): void {
    const id = `${provider}\n${repoId}`
    if (key === null) {
      this.choices.delete(id)
      return
    }
    this.choices.set(id, { key, expiresAt: this.now() + CHOICE_TTL_MS })
  }

  take(worktreeId: string | undefined, provider: SealProvider): SealAccountKey | null {
    if (!worktreeId) {
      return null
    }
    const id = `${provider}\n${getRepoIdFromWorktreeId(worktreeId)}`
    const choice = this.choices.get(id)
    if (!choice) {
      return null
    }
    this.choices.delete(id)
    return choice.expiresAt > this.now() ? choice.key : null
  }
}

const byManager = new WeakMap<object, SealNextLaunchAccounts>()

/** One set of pending choices per account manager, so each runtime spends only its own. */
export function sealNextLaunchAccounts(manager: { now: () => number }): SealNextLaunchAccounts {
  let choices = byManager.get(manager)
  if (!choices) {
    choices = new SealNextLaunchAccounts(() => manager.now())
    byManager.set(manager, choices)
  }
  return choices
}

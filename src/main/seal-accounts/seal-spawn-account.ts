import type { TuiAgent } from '../../shared/agent-launch/catalog/tui-agent'
import type { SealProvider } from '../../shared/seal-accounts/seal-accounts-config'
import type { SealAccountCandidate } from '../../shared/seal-accounts/seal-account-candidates'
import type { SealLaunchPick } from '../../shared/seal-accounts/seal-launch-account-pick'
import {
  SEAL_ACCOUNT_KEY_ENV,
  SEAL_ACCOUNT_LABEL_ENV,
  SEAL_CODEX_ACCOUNT_ID_ENV,
  SEAL_SYSTEM_ACCOUNT,
  sealLaunchOverrideRef
} from '../../shared/seal-accounts/seal-launch-env'
import type { ClaudeRuntimeAuthPreparation } from '../claude-accounts/runtime-auth/runtime-auth-types'
import { getSealAccountManager, type SealAccountManager } from './seal-account-manager'
import { pinClaudeLaunch } from './seal-claude-launch-pin'
import { pickSealLaunch, recordSealSession, sealProjectIdentity } from './seal-launch-pick-context'

export type SealSpawnAccountInput = {
  env: Record<string, string> | undefined
  worktreeId?: string
  tabId?: string
  launchAgent?: TuiAgent
  isClaudeLaunch: boolean
  claudeAuth: ClaudeRuntimeAuthPreparation | null
  /** SSH relays, WSL panes, resumes and adopted panes keep Orca's own routing. */
  skip: boolean
}

export type SealSpawnAccountResult = {
  env: Record<string, string>
  claudeAuth: ClaudeRuntimeAuthPreparation | null
}

function launchedProvider(input: SealSpawnAccountInput): SealProvider | null {
  if (input.isClaudeLaunch || input.launchAgent === 'claude') {
    return 'claude'
  }
  return input.launchAgent === 'codex' ? 'codex' : null
}

type Applied = { env: Record<string, string>; claudeAuth: ClaudeRuntimeAuthPreparation | null }

async function routeTo(
  manager: SealAccountManager,
  provider: SealProvider,
  candidate: SealAccountCandidate,
  current: Applied,
  isClaudeLaunch: boolean
): Promise<Applied> {
  if (candidate.kind === 'api-key') {
    const apiKey = candidate.localId ? manager.vault.read(candidate.localId) : null
    if (!apiKey) {
      throw new Error(
        `The API key for ${candidate.label} could not be read from this machine’s keychain.`
      )
    }
    const keyEnv: Record<string, string> =
      provider === 'claude'
        ? { ANTHROPIC_API_KEY: apiKey }
        : { OPENAI_API_KEY: apiKey, CODEX_API_KEY: apiKey }
    return { ...current, env: { ...current.env, ...keyEnv } }
  }
  if (candidate.active) {
    return current
  }
  if (provider === 'codex') {
    return {
      ...current,
      env: { ...current.env, [SEAL_CODEX_ACCOUNT_ID_ENV]: candidate.localId ?? SEAL_SYSTEM_ACCOUNT }
    }
  }
  const pin = await pinClaudeLaunch({
    router: manager.services.claudeRuntimeAuth.router,
    dataRoot: manager.dataRoot,
    accountId: candidate.localId,
    env: current.env
  })
  return { env: pin.env, claudeAuth: isClaudeLaunch ? pin.preparation : current.claudeAuth }
}

function assignmentLabel(
  pick: SealLaunchPick,
  manager: SealAccountManager,
  provider: SealProvider
) {
  if (pick.kind === 'account') {
    return { key: pick.candidate.key, label: pick.candidate.label }
  }
  const selected = manager.candidates(provider).find((candidate) => candidate.active)
  return { key: selected?.key ?? null, label: selected?.label ?? 'System default' }
}

/**
 * Seal's launch hook: picks the account a new session runs on by override, workspace pin and
 * policy, and routes only that session there. Plain shells take explicit pins and policy
 * defaults so a typed `claude` or `codex` follows the project; agent launches also auto-rank.
 */
export async function applySealSpawnAccount(
  input: SealSpawnAccountInput
): Promise<SealSpawnAccountResult | null> {
  const manager = getSealAccountManager()
  if (!manager || input.skip) {
    return null
  }
  const launched = launchedProvider(input)
  const providers: SealProvider[] = launched ? [launched] : ['claude', 'codex']
  let applied: Applied = { env: { ...input.env }, claudeAuth: input.claudeAuth }
  let changed = false
  for (const provider of providers) {
    const ref = sealLaunchOverrideRef(input.env, provider)
    let pick: SealLaunchPick
    try {
      pick = pickSealLaunch(manager, {
        provider,
        worktreeId: input.worktreeId,
        override: ref ? { ref, source: 'env' } : null,
        autoRank: launched !== null
      })
    } catch (error) {
      console.warn('[seal-accounts] Account pick failed; using the selected account:', error)
      continue
    }
    if (pick.kind === 'account' && !(launched === null && pick.candidate.kind === 'api-key')) {
      try {
        applied = await routeTo(manager, provider, pick.candidate, applied, input.isClaudeLaunch)
        changed = true
      } catch (error) {
        if (ref) {
          throw error
        }
        console.warn(
          '[seal-accounts] Could not route the launch; using the selected account:',
          error
        )
        pick = { kind: 'unchanged', warnings: [...pick.warnings, String(error)] }
      }
    }
    if (!launched) {
      continue
    }
    const account = assignmentLabel(pick, manager, provider)
    if (account.key) {
      applied.env[SEAL_ACCOUNT_KEY_ENV] = account.key
      applied.env[SEAL_ACCOUNT_LABEL_ENV] = account.label
      changed = true
    }
    const project = sealProjectIdentity(manager, input.worktreeId)
    recordSealSession(manager, {
      provider,
      accountKey: account.key,
      accountLabel: account.label,
      reason: pick.kind === 'account' ? pick.reason : 'host-selection',
      worktreeId: input.worktreeId ?? null,
      tabId: input.tabId ?? null,
      projectLabel: project?.displayName ?? project?.remoteKey ?? project?.repoId ?? null,
      warnings: pick.warnings
    })
  }
  return changed ? applied : null
}

type PreflightArgs = {
  env?: Record<string, string>
  worktreeId?: string
  tabId?: string
  launchAgent?: TuiAgent
  command?: string
  connectionId?: string | null
  sessionId?: string
  resumeProviderSession?: unknown
}

type PreflightState = {
  isClaudeLaunch: boolean
  claudeAuth: ClaudeRuntimeAuthPreparation | null
  preAdoptedStablePane: unknown
  codexSelectionTarget?: { runtime?: string }
}

/** Both PTY spawn preflights call this right after Orca resolves the host's own routing. */
export async function routeSealSpawnAccount(
  args: PreflightArgs,
  ctx: PreflightState
): Promise<void> {
  const result = await applySealSpawnAccount({
    env: args.env,
    worktreeId: args.worktreeId,
    tabId: args.tabId,
    launchAgent: args.launchAgent,
    isClaudeLaunch: ctx.isClaudeLaunch,
    claudeAuth: ctx.claudeAuth,
    skip:
      Boolean(args.connectionId) ||
      Boolean(ctx.preAdoptedStablePane) ||
      args.resumeProviderSession !== undefined ||
      ctx.codexSelectionTarget?.runtime === 'wsl' ||
      (args.sessionId !== undefined && !args.command)
  })
  if (result) {
    args.env = result.env
    ctx.claudeAuth = result.claudeAuth
  }
}

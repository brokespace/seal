import type { ClaudeAccountRecipe } from '../../../../shared/agent-session/lifecycle/agent-session-acquired-account'
import type { ClaudeProfileRouter } from '../../../claude-accounts/profiles/routing/claude-profile-router'
import { applyClaudeEnvPatch } from '../../../claude-accounts/runtime-auth/environment'
import { resolveStructuredClaudeAccountHomePath } from '../../../runtime/agent-session/environment/structured-agent-account-home'
import type { ClaudeRuntimeAuthPreparation } from '../../../claude-accounts/runtime-auth/runtime-auth-types'

/**
 * The account a launch runs under is the current selection, or the one Seal routed the chat to;
 * the receipt records what it used.
 */
export async function prepareClaudeLaunchAccount(
  router: ClaudeProfileRouter | undefined,
  env: Record<string, string>,
  recordHome: string,
  routed: ClaudeRuntimeAuthPreparation | null = null
): Promise<ClaudeAccountRecipe> {
  if (!router) {
    return { route: 'system', home: recordHome, configDir: env.CLAUDE_CONFIG_DIR ?? null }
  }
  const preparation = routed ?? (await router.prepareLaunch())
  const home =
    preparation.provenance === 'system'
      ? await resolveStructuredClaudeAccountHomePath({
          launchEnv: env,
          wslDistro: null,
          getClaudeConfigDirectory: () => router.systemDefaultHome()
        })
      : preparation.configDir
  applyClaudeEnvPatch(env, preparation.envPatch)
  const accountId = managedAccountId(preparation.provenance)
  return accountId
    ? { route: 'managed', accountId, home }
    : { route: 'system', home, configDir: env.CLAUDE_CONFIG_DIR ?? null }
}

/** `profile:<id>` from the selection, or `seal:<id>` when Seal pinned the launch to an account. */
function managedAccountId(provenance: string): string | null {
  for (const prefix of ['profile:', 'seal:']) {
    const id = provenance.startsWith(prefix) ? provenance.slice(prefix.length) : ''
    if (id && id !== 'system') {
      return id
    }
  }
  return null
}

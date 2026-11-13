import type { SealProvider } from './seal-accounts-config'

/** Launch override: an account alias, email or key for whichever agent the session starts. */
export const SEAL_ACCOUNT_ENV = 'SEAL_ACCOUNT'

export const SEAL_PROVIDER_ACCOUNT_ENV: Record<SealProvider, string> = {
  claude: 'SEAL_CLAUDE_ACCOUNT',
  codex: 'SEAL_CODEX_ACCOUNT'
}

/** Set on launched sessions so agents (and `seal account current`) can see which account they run on. */
export const SEAL_ACCOUNT_KEY_ENV = 'SEAL_ACCOUNT_KEY'
export const SEAL_ACCOUNT_LABEL_ENV = 'SEAL_ACCOUNT_LABEL'

/** This host's Codex account id a launch is pinned to, or SEAL_SYSTEM_ACCOUNT for ~/.codex. */
export const SEAL_CODEX_ACCOUNT_ID_ENV = 'SEAL_CODEX_ACCOUNT_ID'
export const SEAL_SYSTEM_ACCOUNT = 'system'

/** A session's own CODEX_HOME, which Seal rewrites to move that one session to another login. */
export const SEAL_CODEX_SESSION_HOME_ENV = 'SEAL_CODEX_SESSION_HOME'

export function sealLaunchOverrideRef(
  env: Readonly<Record<string, string | undefined>> | undefined,
  provider: SealProvider
): string | null {
  const value = env?.[SEAL_PROVIDER_ACCOUNT_ENV[provider]] ?? env?.[SEAL_ACCOUNT_ENV]
  return value?.trim() ? value.trim() : null
}

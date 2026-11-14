import type { SealAccountKey, SealProvider } from './seal-accounts-config'

export type ParsedSealAccountKey =
  | { kind: 'oauth'; provider: SealProvider; email: string; scope: string | null }
  | { kind: 'api-key'; provider: SealProvider; id: string }

export function oauthAccountKey(
  provider: SealProvider,
  email: string,
  scope?: string | null
): SealAccountKey {
  const base = `${provider}:${email.trim().toLowerCase()}`
  const trimmedScope = scope?.trim()
  return trimmedScope ? `${base}#${trimmedScope}` : base
}

export function apiKeyAccountKey(provider: SealProvider, id: string): SealAccountKey {
  return `${provider}-key:${id}`
}

export function parseSealAccountKey(key: SealAccountKey): ParsedSealAccountKey | null {
  const separator = key.indexOf(':')
  if (separator <= 0) {
    return null
  }
  const head = key.slice(0, separator)
  const rest = key.slice(separator + 1)
  if (!rest) {
    return null
  }
  if (head === 'claude-key' || head === 'codex-key') {
    return { kind: 'api-key', provider: head === 'claude-key' ? 'claude' : 'codex', id: rest }
  }
  if (head !== 'claude' && head !== 'codex') {
    return null
  }
  const hash = rest.indexOf('#')
  const email = (hash === -1 ? rest : rest.slice(0, hash)).toLowerCase()
  const scope = hash === -1 ? null : rest.slice(hash + 1) || null
  return email ? { kind: 'oauth', provider: head, email, scope } : null
}

/** A key saved before the provider reported an org/workspace still names the same login. */
export function sealAccountKeysMatch(left: SealAccountKey, right: SealAccountKey): boolean {
  if (left === right) {
    return true
  }
  const a = parseSealAccountKey(left)
  const b = parseSealAccountKey(right)
  if (!a || !b || a.kind !== b.kind || a.provider !== b.provider) {
    return false
  }
  if (a.kind === 'api-key' || b.kind === 'api-key') {
    return false
  }
  return a.email === b.email && (!a.scope || !b.scope || a.scope === b.scope)
}

export function sealAccountKeyProvider(key: SealAccountKey): SealProvider | null {
  return parseSealAccountKey(key)?.provider ?? null
}

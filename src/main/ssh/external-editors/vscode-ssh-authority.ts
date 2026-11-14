import type { SshTarget } from '../../../shared/ssh-types'
import type { SshConfigHost } from '../config/ssh-config-parser'
import { isOpenSshConfigBackedTarget } from '../system-transport/system-ssh-args'

type VsCodeSshAuthorityResult =
  | { ok: true; authority: string }
  | { ok: false; reason: 'ssh-target-invalid' }
  | { ok: false; reason: 'ssh-alias-required'; host: string; port: number }

export function isValidAuthorityPart(value: string, allowEmpty = false): boolean {
  return (
    (allowEmpty || value.trim().length > 0) &&
    !Array.from(value).some((character) => {
      const codePoint = character.codePointAt(0) ?? 0
      return codePoint <= 0x1f || codePoint === 0x7f
    })
  )
}

/** Remote-SSH takes no port in its authority; an alias the user already wrote carries it. */
function findAuthorityInSshConfig(
  configHosts: readonly SshConfigHost[],
  host: string,
  port: number,
  username: string
): string | null {
  for (const entry of configHosts) {
    if (
      (entry.hostname ?? entry.host).toLowerCase() !== host.toLowerCase() ||
      (entry.port ?? 22) !== port ||
      !isValidAuthorityPart(entry.host) ||
      (entry.user && username && entry.user !== username)
    ) {
      continue
    }
    return entry.user || !username ? entry.host : `${username}@${entry.host}`
  }
  return null
}

export function resolveVsCodeSshAuthority(
  target: SshTarget,
  loadSshConfigHosts: () => readonly SshConfigHost[] = () => []
): VsCodeSshAuthorityResult {
  if (isOpenSshConfigBackedTarget(target)) {
    const configHost = target.configHost ?? ''
    return isValidAuthorityPart(configHost)
      ? { ok: true, authority: configHost.trim() }
      : { ok: false, reason: 'ssh-target-invalid' }
  }

  const host = target.host.trim()
  const username = target.username.trim()
  if (
    !isValidAuthorityPart(target.host) ||
    !isValidAuthorityPart(target.username, true) ||
    !Number.isInteger(target.port) ||
    target.port < 1 ||
    target.port > 65_535
  ) {
    return { ok: false, reason: 'ssh-target-invalid' }
  }
  if (target.port !== 22) {
    const authority = findAuthorityInSshConfig(loadSshConfigHosts(), host, target.port, username)
    return authority
      ? { ok: true, authority }
      : { ok: false, reason: 'ssh-alias-required', host, port: target.port }
  }
  return { ok: true, authority: username ? `${username}@${host}` : host }
}

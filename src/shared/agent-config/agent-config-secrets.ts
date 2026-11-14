import { SENSITIVE_ENV_KEY_PATTERN, SENSITIVE_ENV_VALUE_PATTERN } from '../mcp-server-inspection'
import { AGENT_CONFIG_SECRET_MASK as MASK } from './agent-config-types'
import { isPlainObject } from './agent-config-values'

/** Keys that name where a secret lives rather than holding one. */
const SECRET_POINTER_KEY = /(env_var|env_key|envVar|Helper|_file|_path)s?$/

export function isSecretValue(key: string, value: string): boolean {
  if (value === '' || SECRET_POINTER_KEY.test(key)) {
    return SENSITIVE_ENV_VALUE_PATTERN.test(value)
  }
  return SENSITIVE_ENV_KEY_PATTERN.test(key) || SENSITIVE_ENV_VALUE_PATTERN.test(value)
}

export function hasMask(value: unknown): boolean {
  if (typeof value === 'string') {
    return value.includes(MASK)
  }
  if (Array.isArray(value)) {
    return value.some(hasMask)
  }
  return isPlainObject(value) && Object.values(value).some(hasMask)
}

export function maskRecord(
  record: Record<string, string>,
  field: string
): { value: Record<string, string>; masked: string[] } {
  const value: Record<string, string> = {}
  const masked: string[] = []
  for (const [key, item] of Object.entries(record)) {
    const secret = isSecretValue(key, item)
    value[key] = secret ? MASK : item
    if (secret) {
      masked.push(`${field}.${key}`)
    }
  }
  return { value, masked }
}

const NAMED_VALUE = /^(-{0,2}[A-Za-z][\w-]*)(\s*[:=]\s*)(.+)$/s

function maskArg(arg: string, previous: string | undefined): string {
  const named = NAMED_VALUE.exec(arg)
  if (named && isSecretValue(named[1], named[3])) {
    return `${named[1]}${named[2]}${MASK}`
  }
  const afterSecretFlag =
    previous !== undefined &&
    /^--?[A-Za-z]/.test(previous) &&
    SENSITIVE_ENV_KEY_PATTERN.test(previous)
  return afterSecretFlag || SENSITIVE_ENV_VALUE_PATTERN.test(arg) ? MASK : arg
}

export function maskArgs(args: readonly string[]): { value: string[]; masked: string[] } {
  const value = args.map((arg, index) => maskArg(arg, args[index - 1]))
  return {
    value,
    masked: value.flatMap((arg, index) => (arg === args[index] ? [] : [`args.${index}`]))
  }
}

/** Hides a password in the address and any query value whose name or shape says secret. */
export function maskUrl(url: string): string {
  return url
    .replace(/(:\/\/[^/@:]*:)[^/@]+@/, `$1${MASK}@`)
    .replace(/([?&])([^=&#]+)=([^&#]*)/g, (whole, lead: string, name: string, value: string) =>
      isSecretValue(name, value) ? `${lead}${name}=${MASK}` : whole
    )
}

function reenter(what: string): Error {
  return new Error(`Enter ${what} again: Seal could not match the hidden value to the stored one`)
}

/** A value the form sent back still masked means "keep what is stored". */
export function restoreRecord(
  draft: Record<string, string>,
  stored: Record<string, string>,
  label: string
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(draft)) {
    if (!value.includes(MASK)) {
      out[key] = value
    } else if (value === MASK && stored[key] !== undefined) {
      out[key] = stored[key]
    } else {
      throw reenter(`the value of ${label} "${key}"`)
    }
  }
  return out
}

export function restoreArgs(draft: readonly string[], stored: readonly string[]): string[] {
  const masked = maskArgs(stored).value
  return draft.map((arg, index) => {
    if (!arg.includes(MASK)) {
      return arg
    }
    const at = masked[index] === arg ? index : masked.indexOf(arg)
    if (at < 0) {
      throw reenter(`argument ${index + 1}`)
    }
    return stored[at]
  })
}

export function restoreUrl(draft: string, stored: string): string {
  if (!draft.includes(MASK)) {
    return draft
  }
  if (maskUrl(stored) !== draft) {
    throw reenter('the URL')
  }
  return stored
}

const SECRET_SETTING_KEY =
  /(api[_-]?key|token|secret|password|passwd|credentials?|private[_-]?key|cookie|bearer)$/i
const VARIABLE_TABLES = new Set(['env', 'environment', 'headers', 'http_headers'])

function isSecretSetting(key: string, value: string, variables: boolean): boolean {
  // Only tables of variables are judged by loose key names; `preferred_auth_method` is no secret.
  return variables
    ? isSecretValue(key, value)
    : SENSITIVE_ENV_VALUE_PATTERN.test(value) ||
        (value !== '' && SECRET_SETTING_KEY.test(key) && !SECRET_POINTER_KEY.test(key))
}

export type SecretLeaf = {
  path: (string | number)[]
  value: string
  /** What stands in for it on screen: the mask, or a URL with only its credentials hidden. */
  masked: string
}

/** Every string of a parsed config that must not be shown as written, by where it sits. */
export function secretLeaves(root: unknown): SecretLeaf[] {
  const leaves: SecretLeaf[] = []
  const walk = (
    value: unknown,
    key: string,
    path: (string | number)[],
    variables: boolean
  ): void => {
    if (typeof value === 'string') {
      const masked = isSecretSetting(key, value, variables) ? MASK : maskUrl(value)
      if (masked !== value) {
        leaves.push({ path, value, masked })
      }
    } else if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, key, [...path, index], variables))
    } else if (isPlainObject(value)) {
      for (const [name, item] of Object.entries(value)) {
        walk(item, name, [...path, name], variables || VARIABLE_TABLES.has(key))
      }
    }
  }
  walk(root, '', [], false)
  return leaves
}

/** Copies a parsed config with every secret-looking string replaced by the mask. */
export function maskConfigValue(root: unknown): { value: unknown; maskedPaths: string[] } {
  const maskedPaths: string[] = []
  const walk = (value: unknown, key: string, path: string, variables: boolean): unknown => {
    if (typeof value === 'string') {
      if (isSecretSetting(key, value, variables)) {
        maskedPaths.push(path)
        return MASK
      }
      return value
    }
    if (Array.isArray(value)) {
      return value.map((item, index) => walk(item, key, `${path}.${index}`, variables))
    }
    if (isPlainObject(value)) {
      return Object.fromEntries(
        Object.entries(value).map(([name, item]) => [
          name,
          walk(item, name, path ? `${path}.${name}` : name, variables || VARIABLE_TABLES.has(key))
        ])
      )
    }
    return value
  }
  return { value: walk(root, '', '', false), maskedPaths }
}

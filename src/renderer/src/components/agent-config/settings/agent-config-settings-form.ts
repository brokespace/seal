import type { AgentConfigSettingsEdit } from '../../../../../shared/agent-config/agent-config-types'
import { isPlainObject, valueAtPath } from '../../../../../shared/agent-config/agent-config-values'

export type SettingsFormProps = {
  /** This scope's settings as stored; secrets arrive masked. */
  value: Record<string, unknown>
  patch: (edits: AgentConfigSettingsEdit[]) => void
}

export function textAt(value: Record<string, unknown>, ...path: string[]): string {
  let current: unknown = value
  for (const key of path) {
    current = isPlainObject(current) ? current[key] : undefined
  }
  return typeof current === 'string' ? current : ''
}

export function listAt(value: Record<string, unknown>, ...path: string[]): string[] {
  let current: unknown = value
  for (const key of path) {
    current = isPlainObject(current) ? current[key] : undefined
  }
  return Array.isArray(current)
    ? current.filter((item): item is string => typeof item === 'string')
    : []
}

/** An emptied field removes the key, so the agent's default (or a weaker scope) applies again. */
export function textEdit(path: string[], text: string): AgentConfigSettingsEdit {
  return text === '' ? { path, remove: true } : { path, value: text }
}

/** The whole list is written, so the edit names the list it was made from. */
export function listEdit(
  root: Record<string, unknown>,
  path: string[],
  items: string[]
): AgentConfigSettingsEdit {
  const was = valueAtPath(root, path) ?? null
  return items.length === 0 ? { path, remove: true, was } : { path, value: items, was }
}

/** Radix Select has no empty value; this stands for "not set in this file". */
export const UNSET = '@unset'

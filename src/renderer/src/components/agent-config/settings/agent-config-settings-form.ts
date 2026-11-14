import type { AgentConfigSettingsEdit } from '../../../../../shared/agent-config/agent-config-types'
import { isPlainObject } from '../../../../../shared/agent-config/agent-config-values'

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

export function listEdit(path: string[], items: string[]): AgentConfigSettingsEdit {
  return items.length === 0 ? { path, remove: true } : { path, value: items }
}

/** Radix Select has no empty value; this stands for "not set in this file". */
export const UNSET = '@unset'

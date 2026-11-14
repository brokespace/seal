import { redactString } from '../../observability/redactor'

/** Arguments whose value is payload, not a description of the call: logged by size only. */
const PAYLOAD_KEYS: ReadonlySet<string> = new Set(['content', 'text', 'prompt'])
const MAX_VALUE_CHARS = 300
const MAX_SUMMARY_CHARS = 600

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

function describe(key: string, value: unknown): string {
  if (typeof value === 'string') {
    if (PAYLOAD_KEYS.has(key)) {
      return `<${value.length} chars>`
    }
    return JSON.stringify(clip(redactString(value), MAX_VALUE_CHARS))
  }
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return String(value)
  }
  return Array.isArray(value) ? `<${value.length} items>` : '<object>'
}

/**
 * One line that says what a call asked for, safe to keep: file contents and message bodies are
 * replaced by their length, and anything shaped like a credential is redacted.
 */
export function summarizeMcpToolArguments(args: Record<string, unknown>): string {
  const parts = Object.entries(args)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${describe(key, value)}`)
  return clip(parts.join(' '), MAX_SUMMARY_CHARS)
}

/** An error message for the audit log: bounded, with credentials removed. */
export function auditDetail(message: string): string {
  return clip(redactString(message), MAX_VALUE_CHARS)
}

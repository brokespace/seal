export type JsonRecord = Record<string, unknown>

export function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** One JSONL record, or null for a cut-off or non-object line. */
export function parseJsonRecord(text: string): JsonRecord | null {
  try {
    const value: unknown = JSON.parse(text)
    return isJsonRecord(value) ? value : null
  } catch {
    return null
  }
}

/** A nested object field, or undefined when it is missing or not an object. */
export function recordField(
  record: JsonRecord | null | undefined,
  key: string
): JsonRecord | undefined {
  const value = record?.[key]
  return isJsonRecord(value) ? value : undefined
}

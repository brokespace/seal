// Reading JSONL transcript records defensively: any field may be missing or another type.
import { isJsonRecord, parseJsonRecord } from '../../../shared/live-sessions/transcript-json-record'

export type TranscriptRecord = Record<string, unknown>

export function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

export function recordsOf(text: string | null, dropFirstPartial: boolean): TranscriptRecord[] {
  if (!text) {
    return []
  }
  const lines = text.split('\n')
  if (dropFirstPartial) {
    lines.shift()
  }
  const out: TranscriptRecord[] = []
  for (const line of lines) {
    if (!line.startsWith('{')) {
      continue
    }
    // A cut-off last line parses to null; the next scan reads it whole.
    const record = parseJsonRecord(line)
    if (record) {
      out.push(record)
    }
  }
  return out
}

export function rec(value: unknown): TranscriptRecord | null {
  return isJsonRecord(value) ? value : null
}

export function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

export function timeOf(record: TranscriptRecord): number | null {
  const at = str(record.timestamp)
  const ms = at ? Date.parse(at) : Number.NaN
  return Number.isFinite(ms) ? ms : null
}

export function oneLine(text: string, max = 120): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`
}

export function blocks(content: unknown): TranscriptRecord[] {
  return Array.isArray(content) ? content.map(rec).filter((b) => b !== null) : []
}

/** The text of a message's content, whether a string or text blocks. */
export function contentText(content: unknown): string {
  return typeof content === 'string'
    ? content
    : blocks(content)
        .filter((b) => b.type === 'text')
        .map((b) => str(b.text) ?? '')
        .join('\n')
}

export function toolLabel(name: string, input: TranscriptRecord | null): string {
  const target =
    str(input?.description) ??
    str(input?.command) ??
    (str(input?.file_path) ? basename(str(input?.file_path)!) : null) ??
    str(input?.pattern) ??
    str(input?.url)
  return target ? oneLine(`${name}: ${target}`, 80) : name
}

/** JSON a tool call carries as a string (Codex function arguments and outputs). */
export function jsonField(value: unknown): TranscriptRecord | null {
  if (typeof value !== 'string') {
    return rec(value)
  }
  return value.trimStart().startsWith('{') ? parseJsonRecord(value) : null
}

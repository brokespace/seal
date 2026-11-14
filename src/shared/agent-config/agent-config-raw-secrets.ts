import { editJsonText, parseJsonObject } from './agent-config-json-edit'
import { hasMask, secretLeaves } from './agent-config-secrets'
import { editTomlText, parseTomlObject } from './agent-config-toml-edit'
import { AGENT_CONFIG_SECRET_MASK as MASK, type AgentConfigTomlValue } from './agent-config-types'
import { isPlainObject } from './agent-config-values'

export type RawConfigFormat = 'json' | 'toml'
type Path = (string | number)[]
type LeafEdit = { path: Path; value: string }

/** Files whose text Seal can change value by value; anything else is shown as written. */
export function rawConfigFormat(path: string): RawConfigFormat | null {
  if (/\.jsonc?$/i.test(path)) {
    return 'json'
  }
  return /\.toml$/i.test(path) ? 'toml' : null
}

function parse(format: RawConfigFormat, text: string): Record<string, unknown> | null {
  const parsed = format === 'json' ? parseJsonObject(text) : parseTomlObject(text)
  return parsed.ok ? parsed.value : null
}

function at(root: unknown, path: Path): unknown {
  return path.reduce<unknown>(
    (node, key) =>
      Array.isArray(node) ? node[Number(key)] : isPlainObject(node) ? node[String(key)] : undefined,
    root
  )
}

function isPrimitiveList(value: unknown): value is (string | number | boolean)[] {
  return Array.isArray(value) && value.every((item) => typeof item !== 'object' || item === null)
}

/** TOML is edited by key, so a string inside a list is changed by rewriting that list. */
function tomlEdits(
  root: Record<string, unknown>,
  edits: readonly LeafEdit[]
): { path: string[]; value: AgentConfigTomlValue }[] {
  const lists = new Map<string, { path: string[]; value: (string | number | boolean)[] }>()
  const out: { path: string[]; value: AgentConfigTomlValue }[] = []
  for (const edit of edits) {
    const first = edit.path.findIndex((key) => typeof key === 'number')
    if (first === -1) {
      out.push({ path: edit.path.map(String), value: edit.value })
      continue
    }
    const listPath = edit.path.slice(0, first).map(String)
    const list = at(root, listPath)
    // A string deeper than a plain list (tables inside lists) has no single key to edit.
    if (first !== edit.path.length - 1 || !isPrimitiveList(list)) {
      continue
    }
    const key = JSON.stringify(listPath)
    const entry = lists.get(key) ?? { path: listPath, value: [...list] }
    entry.value[Number(edit.path[first])] = edit.value
    lists.set(key, entry)
  }
  return [...out, ...lists.values()]
}

function applyEdits(
  format: RawConfigFormat,
  text: string,
  root: Record<string, unknown>,
  edits: readonly LeafEdit[]
): string {
  if (edits.length === 0) {
    return text
  }
  return format === 'json' ? editJsonText(text, edits) : editTomlText(text, tomlEdits(root, edits))
}

/**
 * The file's own text with stored secrets replaced by the mask, everything else byte for byte.
 * A file that does not parse is returned as written: it has to be readable to be repaired.
 */
export function maskRawConfigText(format: RawConfigFormat, text: string): string {
  const root = parse(format, text)
  if (!root) {
    return text
  }
  return applyEdits(
    format,
    text,
    root,
    secretLeaves(root).map((leaf) => ({ path: leaf.path, value: leaf.masked }))
  )
}

function maskedStrings(value: unknown, path: Path = []): LeafEdit[] {
  if (typeof value === 'string') {
    return value.includes(MASK) ? [{ path, value }] : []
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => maskedStrings(item, [...path, index]))
  }
  return isPlainObject(value)
    ? Object.entries(value).flatMap(([key, item]) => maskedStrings(item, [...path, key]))
    : []
}

function reenter(path: Path): Error {
  return new Error(
    `Enter the value of ${path.join('.')} again: Seal could not match the hidden value to the stored one`
  )
}

/**
 * Puts stored secrets back where the edited text still shows the mask. A mask that no longer sits
 * where a stored secret was (a renamed key, a list that changed length) is refused, never guessed.
 */
export function unmaskRawConfigText(
  format: RawConfigFormat,
  draft: string,
  stored: string
): string {
  if (!draft.includes(MASK)) {
    return draft
  }
  const next = parse(format, draft)
  if (!next) {
    // Not parseable: validation reports it and nothing is written.
    return draft
  }
  const before = parse(format, stored)
  const storedLeaves = new Map(
    (before ? secretLeaves(before) : []).map((leaf) => [JSON.stringify(leaf.path), leaf])
  )
  const edits = maskedStrings(next).map((masked): LeafEdit => {
    const leaf = storedLeaves.get(JSON.stringify(masked.path))
    const listsKeptLength = masked.path.every((key, index) => {
      if (typeof key !== 'number') {
        return true
      }
      const prefix = masked.path.slice(0, index)
      const now = at(next, prefix)
      const was = at(before, prefix)
      return Array.isArray(now) && Array.isArray(was) && now.length === was.length
    })
    if (!leaf || leaf.masked !== masked.value || !listsKeptLength) {
      throw reenter(masked.path)
    }
    return { path: masked.path, value: leaf.value }
  })
  const restored = applyEdits(format, draft, next, edits)
  if (hasMask(parse(format, restored))) {
    throw new Error('A hidden value could not be put back; enter the real value to change it')
  }
  return restored
}

import { parse, stringify } from 'smol-toml'
import type { AgentConfigTomlEdit, AgentConfigTomlValue } from './agent-config-types'
import { cloneValue, deepEqual, isPlainObject } from './agent-config-values'
import {
  scanToml,
  tomlKeyText,
  type TomlSection,
  type TomlStatement
} from './agent-config-toml-scan'

export type ParsedToml = { ok: true; value: Record<string, unknown> } | { ok: false; error: string }

export function parseTomlObject(text: string): ParsedToml {
  try {
    return { ok: true, value: parse(text) }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, error: message.split('\n')[0] ?? 'Invalid TOML' }
  }
}

function inline(value: AgentConfigTomlValue): string {
  if (Array.isArray(value)) {
    return `[${value.map(inline).join(', ')}]`
  }
  if (isPlainObject(value)) {
    const parts = Object.entries(value).map(
      ([key, item]) => `${tomlKeyText(key)} = ${inline(item)}`
    )
    return parts.length > 0 ? `{ ${parts.join(', ')} }` : '{}'
  }
  return stringify({ v: value }).trim().slice('v = '.length)
}

function isFlat(value: AgentConfigTomlValue): boolean {
  return (
    isPlainObject(value) &&
    Object.values(value).every((item) => !isPlainObject(item) && !Array.isArray(item))
  )
}

function nest(path: readonly string[], value: AgentConfigTomlValue): Record<string, unknown> {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: an edit's path is never empty, so the outermost value is a table.
  return path.reduceRight<AgentConfigTomlValue>(
    (inner, key) => ({ [key]: inner }),
    value
  ) as Record<string, unknown>
}

function startsWith(path: readonly string[], prefix: readonly string[]): boolean {
  return prefix.length <= path.length && prefix.every((key, index) => path[index] === key)
}

function samePath(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && startsWith(a, b)
}

type Located = { section: TomlSection; statement: TomlStatement; full: string[] }

function statements(sections: readonly TomlSection[]): Located[] {
  return sections.flatMap((section) =>
    section.statements.map((statement) => ({
      section,
      statement,
      full: [...section.path, ...statement.path]
    }))
  )
}

function setInValue(root: Record<string, unknown>, path: readonly string[], value: unknown): void {
  let node = root
  for (const key of path.slice(0, -1)) {
    const existing = node[key]
    const next: Record<string, unknown> = isPlainObject(existing) ? existing : {}
    node[key] = next
    node = next
  }
  const leaf = path.at(-1)
  if (leaf !== undefined) {
    node[leaf] = value
  }
}

function removeInValue(root: Record<string, unknown>, path: readonly string[]): void {
  let node = root
  for (const key of path.slice(0, -1)) {
    const next = node[key]
    if (!isPlainObject(next)) {
      return
    }
    node = next
  }
  const leaf = path.at(-1)
  if (leaf !== undefined) {
    delete node[leaf]
  }
}

function valueAt(root: Record<string, unknown>, path: readonly string[]): unknown {
  return path.reduce<unknown>((node, key) => (isPlainObject(node) ? node[key] : undefined), root)
}

/** Rewrites one `key = value` statement in place, keeping its indentation and trailing comment. */
function rewriteStatement(lines: string[], statement: TomlStatement, value: string): void {
  const first = lines[statement.start] ?? ''
  const keyText = first.slice(0, first.indexOf('=')).trimEnd()
  const comment = statement.end - statement.start === 1 ? trailingComment(first) : ''
  lines.splice(
    statement.start,
    statement.end - statement.start,
    `${keyText} = ${value}${comment ? ` ${comment}` : ''}`
  )
}

function trailingComment(line: string): string {
  for (let index = line.indexOf('#'); index >= 0; index = line.indexOf('#', index + 1)) {
    if (parseTomlObject(line.slice(0, index)).ok) {
      return line.slice(index)
    }
  }
  return ''
}

function removeLines(lines: string[], start: number, end: number): void {
  // A removed block takes the blank lines after it along, so gaps do not pile up.
  let stop = end
  while (stop < lines.length && lines[stop]?.trim() === '') {
    stop += 1
  }
  lines.splice(start, stop - start)
}

function blockLines(path: readonly string[], value: AgentConfigTomlValue): string[] {
  const text = stringify(nest(path, value)).trim()
  // smol-toml prints no header for an empty table.
  return (text === '' ? `[${path.map(tomlKeyText).join('.')}]` : text).split('\n')
}

function applyEdit(
  text: string,
  edit: AgentConfigTomlEdit,
  expected: Record<string, unknown>
): string {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.split(/\r?\n/)
  const sections = scanToml(lines)
  const path = edit.path
  if (sections.some((section) => section.array && startsWith(path, section.path))) {
    throw new Error('Seal does not edit inside [[array]] tables; use the raw editor')
  }
  const all = statements(sections)
  const exact = all.find((item) => samePath(item.full, path))
  const enclosing = all.find(
    (item) => item.full.length < path.length && startsWith(path, item.full)
  )
  const owned = sections.filter((section) => section.header >= 0 && startsWith(section.path, path))
  const value = 'remove' in edit ? undefined : edit.value

  if (enclosing) {
    // The value lives inside an inline table or dotted key: reprint that one statement.
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: `expected` is a parsed TOML document, so everything in it is a TOML value.
    const parent = valueAt(expected, enclosing.full) as AgentConfigTomlValue | undefined
    if (parent === undefined) {
      removeLines(lines, enclosing.statement.start, enclosing.statement.end)
    } else {
      rewriteStatement(lines, enclosing.statement, inline(parent))
    }
  } else if (exact) {
    if (value === undefined) {
      lines.splice(exact.statement.start, exact.statement.end - exact.statement.start)
    } else {
      rewriteStatement(lines, exact.statement, inline(value))
    }
  } else if (owned.length > 0) {
    const at = owned[0].header
    for (const section of owned.toReversed()) {
      removeLines(lines, section.header, section.end)
    }
    if (value !== undefined) {
      lines.splice(at, 0, ...blockLines(path, value), '')
    }
  } else if (value !== undefined) {
    const parentPath = path.slice(0, -1)
    const parent = sections.find((section) => !section.array && samePath(section.path, parentPath))
    const leaf = path.at(-1) ?? ''
    const key = tomlKeyText(leaf)
    if (parent && (!isPlainObject(value) || isFlat(value))) {
      lines.splice(parent.end, 0, `${key} = ${inline(value)}`)
    } else {
      const block = isPlainObject(value)
        ? blockLines(path, value)
        : blockLines(parentPath, { [leaf]: value })
      while (lines.length > 0 && lines.at(-1)?.trim() === '') {
        lines.pop()
      }
      lines.push(...(lines.length > 0 ? [''] : []), ...block, '')
    }
  }
  return lines.join(eol)
}

/**
 * Changes only the named keys and tables; comments, ordering and every other table stay as
 * written. Throws rather than return text that parses to anything but the old content plus
 * these edits.
 */
export function editTomlText(text: string, edits: readonly AgentConfigTomlEdit[]): string {
  const parsed = parseTomlObject(text)
  if (!parsed.ok) {
    throw new Error(`The file is not valid TOML (${parsed.error}); fix it in the raw editor first`)
  }
  const expected = cloneValue(parsed.value)
  let next = text
  for (const edit of edits) {
    if (edit.path.length === 0) {
      throw new Error('An edit needs a path')
    }
    if ('remove' in edit) {
      removeInValue(expected, edit.path)
    } else {
      setInValue(expected, edit.path, edit.value)
    }
    next = applyEdit(next, edit, expected)
  }
  const result = parseTomlObject(next)
  if (!result.ok || !deepEqual(result.value, expected)) {
    throw new Error('The edit would have changed other parts of the file, so nothing was written')
  }
  return next
}

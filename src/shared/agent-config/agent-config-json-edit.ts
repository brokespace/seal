import {
  applyEdits,
  modify,
  parse,
  printParseErrorCode,
  type FormattingOptions,
  type ParseError
} from 'jsonc-parser'
import type { AgentConfigJsonEdit } from './agent-config-types'
import { deepEqual, isPlainObject } from './agent-config-values'

export type ParsedJsonObject =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: string }

function lineOf(text: string, offset: number): number {
  return text.slice(0, offset).split('\n').length
}

/** Reads a JSON or JSONC object; an empty file counts as an empty object. */
export function parseJsonObject(text: string): ParsedJsonObject {
  if (text.trim() === '') {
    return { ok: true, value: {} }
  }
  const errors: ParseError[] = []
  const value: unknown = parse(text, errors, { allowTrailingComma: true })
  if (errors.length > 0) {
    const first = errors[0]
    return {
      ok: false,
      error: `${printParseErrorCode(first.error)} on line ${lineOf(text, first.offset)}`
    }
  }
  if (!isPlainObject(value)) {
    return { ok: false, error: 'The file must hold a JSON object' }
  }
  return { ok: true, value }
}

function formattingOf(text: string): FormattingOptions {
  const indent = /\n([ \t]+)\S/.exec(text)?.[1]
  return {
    insertSpaces: !indent?.startsWith('\t'),
    tabSize: indent && !indent.startsWith('\t') ? indent.length : 2,
    eol: text.includes('\r\n') ? '\r\n' : '\n'
  }
}

type Container = Record<string, unknown> | unknown[]

function childOf(node: Container, segment: string | number): unknown {
  if (Array.isArray(node)) {
    return typeof segment === 'number' ? node[segment] : undefined
  }
  return node[String(segment)]
}

function setChild(node: Container, segment: string | number, value: unknown): void {
  if (!Array.isArray(node)) {
    node[String(segment)] = value
  } else if (typeof segment === 'number') {
    node[segment] = value
  }
}

function applyToValue(root: Record<string, unknown>, edit: AgentConfigJsonEdit): void {
  let node: Container = root
  for (const [index, segment] of edit.path.slice(0, -1).entries()) {
    const existing = childOf(node, segment)
    if (isPlainObject(existing) || Array.isArray(existing)) {
      node = existing
      continue
    }
    if ('remove' in edit) {
      return
    }
    const created: Container = typeof edit.path[index + 1] === 'number' ? [] : {}
    setChild(node, segment, created)
    node = created
  }
  const last = edit.path.at(-1)
  if (last === undefined) {
    throw new Error('An edit needs a path')
  }
  if (!('remove' in edit)) {
    setChild(node, last, edit.value)
  } else if (!Array.isArray(node)) {
    delete node[String(last)]
  } else if (typeof last === 'number') {
    node.splice(last, 1)
  }
}

/**
 * Changes only the named paths and leaves every other byte of the file alone: key order, comments,
 * indentation and fields Seal does not know. Throws rather than return text that parses to
 * anything but the old content plus these edits.
 */
export function editJsonText(text: string, edits: readonly AgentConfigJsonEdit[]): string {
  const source = text.trim() === '' ? '{}\n' : text
  const parsed = parseJsonObject(source)
  if (!parsed.ok) {
    throw new Error(`The file is not valid JSON (${parsed.error}); fix it in the raw editor first`)
  }
  const expected = structuredClone(parsed.value)
  const formattingOptions = formattingOf(source)
  let next = source
  for (const edit of edits) {
    applyToValue(expected, edit)
    next = applyEdits(
      next,
      modify(next, edit.path, 'remove' in edit ? undefined : edit.value, { formattingOptions })
    )
  }
  const result = parseJsonObject(next)
  if (!result.ok || !deepEqual(result.value, expected)) {
    throw new Error('The edit would have changed other parts of the file, so nothing was written')
  }
  return next
}

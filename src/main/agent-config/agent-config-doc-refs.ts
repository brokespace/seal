import type { AgentConfigCollection } from '../../shared/agent-config/agent-config-catalog'
import {
  readFrontmatter,
  validateMarkdownDocument
} from '../../shared/agent-config/agent-config-frontmatter'
import { parseTomlObject } from '../../shared/agent-config/agent-config-toml-edit'
import type {
  AgentConfigDocRef,
  AgentConfigIssue,
  AgentConfigScope
} from '../../shared/agent-config/agent-config-types'
import { machinePathBasename, machinePathDirname } from '../../shared/machines/machine-paths'
import { summarizeSkillMarkdown } from '../../shared/skill-metadata'
import type { MachineFileScanRecord } from '../machines/scan/machine-file-scan'

function relativeTo(root: string, path: string): string {
  const prefix = root.replaceAll('\\', '/').replace(/\/+$/, '')
  const normalized = path.replaceAll('\\', '/')
  return normalized.startsWith(`${prefix}/`) ? normalized.slice(prefix.length + 1) : normalized
}

/** A document's name inside its collection: `review` or, in a sub-folder, `frontend/review`. */
export function collectionEntryName(path: string, collection: AgentConfigCollection): string {
  const normalized = path.replaceAll('\\', '/')
  const marker = `/${collection.dir}/`
  const at = normalized.lastIndexOf(marker)
  const inside = at === -1 ? machinePathBasename(path) : normalized.slice(at + marker.length)
  return inside.endsWith(collection.extension)
    ? inside.slice(0, -collection.extension.length)
    : inside
}

function tomlDocument(
  head: string,
  complete: boolean
): { description: string; issues: AgentConfigIssue[] } {
  if (!complete) {
    return { description: '', issues: [] }
  }
  const parsed = parseTomlObject(head)
  if (!parsed.ok) {
    return {
      description: '',
      issues: [{ severity: 'error', message: `Not valid TOML: ${parsed.error}` }]
    }
  }
  const description = parsed.value.description
  return { description: typeof description === 'string' ? description : '', issues: [] }
}

export function docFromRecord(
  record: MachineFileScanRecord,
  scope: AgentConfigScope,
  collection: AgentConfigCollection,
  headBytes: number
): AgentConfigDocRef {
  const complete = record.bytes <= headBytes
  const skill = collection.shape === 'skill-folders'
  const directory = skill ? machinePathDirname(record.path) : null
  const fileName = skill
    ? machinePathBasename(directory ?? record.path)
    : collectionEntryName(record.path, collection)
  const base = { kind: collection.kind, scope, path: record.path, directory, bytes: record.bytes }
  if (collection.extension === '.toml') {
    return { ...base, name: fileName, ...tomlDocument(record.head, complete) }
  }
  // The same reader the home chat lists skills with, so both name a document alike.
  const summary = summarizeSkillMarkdown(record.head)
  const frontmatter = readFrontmatter(record.head)
  const declared =
    collection.kind === 'skill' || collection.kind === 'subagent'
      ? frontmatter.data.name
      : undefined
  const checkable = complete || frontmatter.complete || !frontmatter.present
  return {
    ...base,
    name: typeof declared === 'string' && declared.trim() ? declared.trim() : fileName,
    description: frontmatter.present || skill ? (summary.description ?? '') : '',
    issues: checkable
      ? validateMarkdownDocument(collection.kind, record.head, machinePathBasename(fileName))
      : []
  }
}

export function instructionsFromRecord(
  record: MachineFileScanRecord,
  scope: AgentConfigScope,
  projectRoot: string | null
): AgentConfigDocRef {
  const heading = /^#\s+(.+)$/m.exec(record.head)?.[1]?.trim() ?? ''
  return {
    kind: 'instructions',
    scope,
    name: machinePathBasename(record.path),
    description: heading,
    path: record.path,
    directory: null,
    bytes: record.bytes,
    ...(projectRoot ? { relativePath: relativeTo(projectRoot, record.path) } : {}),
    issues: []
  }
}

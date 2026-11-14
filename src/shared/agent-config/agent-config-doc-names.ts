import type { AgentConfigDocKind } from './agent-config-types'

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const FILE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/** Why a name cannot be used for a document of this kind, or null when it can. */
export function agentConfigDocNameProblem(kind: AgentConfigDocKind, name: string): string | null {
  const trimmed = name.trim()
  // Agents match skills and subagents by a name that must equal the folder or file.
  if (kind === 'skill' || kind === 'subagent') {
    return trimmed.length <= 64 && SLUG.test(trimmed)
      ? null
      : 'Use lowercase letters, digits and hyphens for the name (64 at most)'
  }
  return trimmed.length <= 120 && trimmed.split('/').every((segment) => FILE_SEGMENT.test(segment))
    ? null
    : 'Use letters, digits, dots, dashes and underscores; "/" makes a sub-folder'
}

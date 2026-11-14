import { isAgentConfigAgentId } from '../../shared/agent-config/agent-config-catalog'
import type {
  AgentConfigDocKind,
  AgentConfigMcpDraft,
  AgentConfigScope,
  AgentConfigSettingsEdit,
  AgentConfigTarget
} from '../../shared/agent-config/agent-config-types'
import {
  isPlainObject,
  stringList,
  stringRecord
} from '../../shared/agent-config/agent-config-values'
import { machineIdOf, requireString, requireStrings } from '../machines/machine-ipc-args'
import type { DocumentRef } from './agent-config-documents'

const SCOPES: readonly AgentConfigScope[] = ['user', 'project', 'local']
export const DOC_KINDS: readonly AgentConfigDocKind[] = [
  'instructions',
  'skill',
  'subagent',
  'command',
  'prompt',
  'rule'
]

export function targetOf(value: unknown): AgentConfigTarget {
  if (!isPlainObject(value) || !isAgentConfigAgentId(value.agent)) {
    throw new Error('Unknown agent')
  }
  return {
    machineId: machineIdOf(value.machineId),
    agent: value.agent,
    ...(typeof value.projectPath === 'string' && value.projectPath
      ? { projectPath: value.projectPath }
      : {})
  }
}

export function scopeOf(value: unknown): AgentConfigScope {
  const scope = SCOPES.find((candidate) => candidate === value)
  if (!scope) {
    throw new Error('Unknown scope')
  }
  return scope
}

export function refOf(value: unknown): DocumentRef {
  const kind = isPlainObject(value) ? DOC_KINDS.find((candidate) => candidate === value.kind) : null
  if (!isPlainObject(value) || !kind) {
    throw new Error('Unknown document')
  }
  return { kind, scope: scopeOf(value.scope), path: requireString(value.path, 'path') }
}

export function draftOf(value: unknown): AgentConfigMcpDraft {
  if (!isPlainObject(value)) {
    throw new Error('A server needs settings')
  }
  const transport = value.transport
  if (transport !== 'stdio' && transport !== 'http' && transport !== 'sse') {
    throw new Error('Unknown transport')
  }
  return {
    name: requireString(value.name, 'name'),
    transport,
    command: typeof value.command === 'string' ? value.command : '',
    args: stringList(value.args),
    env: stringRecord(value.env),
    url: typeof value.url === 'string' ? value.url : '',
    headers: stringRecord(value.headers),
    enabled: value.enabled !== false
  }
}

export function editsOf(value: unknown): AgentConfigSettingsEdit[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('Nothing to change')
  }
  return value.map((edit): AgentConfigSettingsEdit => {
    if (!isPlainObject(edit)) {
      throw new Error('Unknown edit')
    }
    const path = requireStrings(edit.path, 'path')
    return edit.remove === true ? { path, remove: true } : { path, value: edit.value }
  })
}

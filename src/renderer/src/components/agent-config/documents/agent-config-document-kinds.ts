import type { Translate } from '@/i18n/use-translate'
import type { AgentConfigLayout } from '../../../../../shared/agent-config/agent-config-catalog'
import type {
  AgentConfigDocKind,
  AgentConfigDocRef,
  AgentConfigScope
} from '../../../../../shared/agent-config/agent-config-types'
import { machinePathBasename } from '../../../../../shared/machines/machine-paths'
import type { AgentConfigOpenDocument } from './AgentConfigDocumentSheet'

export function agentConfigKindTitle(kind: AgentConfigDocKind, t: Translate): string {
  switch (kind) {
    case 'instructions':
      return t('auto.components.agentConfig.kind.instructions', 'Instructions')
    case 'skill':
      return t('auto.components.agentConfig.kind.skills', 'Skills')
    case 'subagent':
      return t('auto.components.agentConfig.kind.subagents', 'Subagents')
    case 'command':
      return t('auto.components.agentConfig.kind.commands', 'Slash commands')
    case 'prompt':
      return t('auto.components.agentConfig.kind.prompts', 'Prompts')
    case 'rule':
      return t('auto.components.agentConfig.kind.rules', 'Rules')
  }
}

export function agentConfigKindNoun(kind: AgentConfigDocKind, t: Translate): string {
  switch (kind) {
    case 'instructions':
      return t('auto.components.agentConfig.noun.instructions', 'instructions file')
    case 'skill':
      return t('auto.components.agentConfig.noun.skill', 'skill')
    case 'subagent':
      return t('auto.components.agentConfig.noun.subagent', 'subagent')
    case 'command':
      return t('auto.components.agentConfig.noun.command', 'slash command')
    case 'prompt':
      return t('auto.components.agentConfig.noun.prompt', 'prompt')
    case 'rule':
      return t('auto.components.agentConfig.noun.rule', 'rule')
  }
}

/** What the editor needs to open a listed document with the right checks. */
export function openDocumentFor(doc: AgentConfigDocRef): AgentConfigOpenDocument {
  const file = machinePathBasename(doc.path)
  const expectedName =
    doc.kind === 'skill' && doc.directory
      ? machinePathBasename(doc.directory)
      : doc.kind === 'subagent'
        ? file.replace(/\.[^.]+$/, '')
        : undefined
  return {
    path: doc.path,
    title: doc.kind === 'instructions' ? (doc.relativePath ?? doc.name) : doc.name,
    validation: file.endsWith('.toml') ? 'toml' : doc.kind,
    scope: doc.scope,
    ...(expectedName ? { expectedName } : {})
  }
}

export type CreatableInstructions = { scope: AgentConfigScope; relative: string }

/** Instruction files the agent reads here that do not exist yet. */
export function missingInstructions(
  layout: AgentConfigLayout,
  homeScope: 'user' | 'project',
  docs: readonly AgentConfigDocRef[]
): CreatableInstructions[] {
  const candidates: CreatableInstructions[] =
    homeScope === 'user'
      ? layout.user.instructions.map((relative) => ({ scope: 'user', relative }))
      : [
          ...layout.project.instructions.map((relative): CreatableInstructions => ({
            scope: 'project',
            relative
          })),
          ...layout.project.localInstructions.map((relative): CreatableInstructions => ({
            scope: 'local',
            relative
          }))
        ]
  const existing = docs
    .filter((doc) => doc.kind === 'instructions')
    .map((doc) => doc.path.replaceAll('\\', '/'))
  return candidates.filter(
    (candidate) => !existing.some((path) => path.endsWith(`/${candidate.relative}`))
  )
}

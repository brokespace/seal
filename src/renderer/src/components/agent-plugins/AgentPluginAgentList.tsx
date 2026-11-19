import React from 'react'
import { useTranslate, type Translate } from '@/i18n/use-translate'
import { cn } from '@/lib/class-names'
import { agentConfigLayout } from '../../../../shared/agent-config/agent-config-catalog'
import type { AgentConfigAgentId } from '../../../../shared/agent-config/agent-config-types'
import type { AgentPluginAgentPlan } from '../../../../shared/agent-plugins/agent-plugin-plan'
import type {
  AgentPluginAgentState,
  AgentPluginComponentKind,
  AgentPluginComponents,
  AgentPluginMode
} from '../../../../shared/agent-plugins/agent-plugin-types'
import { SettingsBadge } from '../settings/form-controls/SettingsFormControls'

/** One agent's line, from a plan before installing or from what was written after. */
export type AgentPluginAgentLine = {
  agent: AgentConfigAgentId
  mode: AgentPluginMode
  mcpServers: number
  skills: number
  skillsVia: AgentConfigAgentId | null
  notApplicable: AgentPluginComponentKind[]
  skipped: string[]
  error?: string
}

export function linesFromPlan(
  plans: readonly AgentPluginAgentPlan[],
  components: AgentPluginComponents
): AgentPluginAgentLine[] {
  return plans.map((plan) => ({
    agent: plan.agent,
    mode: plan.mode,
    mcpServers: plan.mcpServers ? components.mcpServers.length : 0,
    skills: plan.skillsDir || plan.skillsVia ? components.skills.length : 0,
    skillsVia: plan.skillsVia,
    notApplicable: plan.notApplicable,
    skipped: []
  }))
}

export function linesFromStates(states: readonly AgentPluginAgentState[]): AgentPluginAgentLine[] {
  return states.map((state) => ({
    agent: state.agent,
    mode: state.mode,
    mcpServers: state.mcpServers.length,
    skills: state.skills.length,
    skillsVia: state.skills.find((skill) => skill.via)?.via ?? null,
    notApplicable: state.notApplicable,
    skipped: state.skipped,
    ...(state.error ? { error: state.error } : {})
  }))
}

function kindLabel(kind: AgentPluginComponentKind, t: Translate): string {
  switch (kind) {
    case 'mcpServers':
      return t('seal.agentPlugins.kind.mcpServers', 'MCP servers')
    case 'skills':
      return t('seal.agentPlugins.kind.skills', 'skills')
    case 'commands':
      return t('seal.agentPlugins.kind.commands', 'commands')
    case 'agents':
      return t('seal.agentPlugins.kind.agents', 'subagents')
    case 'hooks':
      return t('seal.agentPlugins.kind.hooks', 'hooks')
    case 'lspServers':
      return t('seal.agentPlugins.kind.lspServers', 'LSP servers')
    case 'apps':
      return t('seal.agentPlugins.kind.apps', 'apps')
  }
}

function describe(line: AgentPluginAgentLine, t: Translate): string {
  switch (line.mode) {
    case 'native':
      return t('seal.agentPlugins.mode.native', 'Its own installer, everything included')
    case 'absent':
      return t('seal.agentPlugins.mode.absent', 'Not on this machine')
    case 'excluded':
      return t('seal.agentPlugins.mode.excluded', 'Left out by where this plugin applies')
    case 'translated': {
      const parts = [
        line.mcpServers > 0
          ? t('seal.agentPlugins.mode.mcp', '{{count}} MCP servers', { count: line.mcpServers })
          : '',
        line.skills > 0
          ? line.skillsVia
            ? t('seal.agentPlugins.mode.skillsVia', '{{count}} skills through {{agent}}’s folder', {
                count: line.skills,
                agent: agentConfigLayout(line.skillsVia).label
              })
            : t('seal.agentPlugins.mode.skills', '{{count}} skills', { count: line.skills })
          : ''
      ].filter(Boolean)
      return parts.length > 0
        ? parts.join(', ')
        : t('seal.agentPlugins.mode.nothing', 'Nothing it can use')
    }
  }
}

/** Per agent: what it gets from the plugin, and what does not apply to it, said plainly. */
export function AgentPluginAgentList({
  lines
}: {
  lines: readonly AgentPluginAgentLine[]
}): React.JSX.Element {
  const t = useTranslate()
  return (
    <ul className="space-y-1" data-agent-plugin-agents="">
      {lines.map((line) => (
        <li
          key={line.agent}
          className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs"
          data-agent-plugin-agent={line.agent}
          data-agent-plugin-mode={line.mode}
        >
          <span
            className={cn(
              'w-28 shrink-0 font-medium',
              (line.mode === 'absent' || line.mode === 'excluded') && 'text-muted-foreground'
            )}
          >
            {agentConfigLayout(line.agent).label}
          </span>
          <span className="text-muted-foreground">{describe(line, t)}</span>
          {line.notApplicable.length > 0 ? (
            <SettingsBadge tone="muted">
              {t('seal.agentPlugins.notApplicable', 'No {{kinds}} here', {
                kinds: line.notApplicable.map((kind) => kindLabel(kind, t)).join(', ')
              })}
            </SettingsBadge>
          ) : null}
          {line.skipped.map((reason) => (
            <span key={reason} className="basis-full pl-30 text-muted-foreground">
              {reason}
            </span>
          ))}
          {line.error ? (
            <span className="basis-full pl-30 text-destructive [overflow-wrap:anywhere]">
              {line.error}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  )
}

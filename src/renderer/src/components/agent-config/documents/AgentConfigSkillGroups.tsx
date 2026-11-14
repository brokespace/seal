import React from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { useTranslate } from '@/i18n/use-translate'
import type { AgentConfigCollection } from '../../../../../shared/agent-config/agent-config-layout-types'
import type { AgentConfigDocRef } from '../../../../../shared/agent-config/agent-config-types'
import { SettingsGroup } from '../../settings/section-layout/SettingsGroup'
import { agentConfigApi } from '../model/agent-config-client'
import { useAgentConfig } from '../model/agent-config-context'
import {
  AgentConfigDocumentRow,
  type AgentConfigDocumentRowActions
} from './AgentConfigDocumentRow'
import {
  agentConfigShortPath,
  agentConfigSkillGroups,
  type AgentConfigSkillGroup
} from './agent-config-skill-groups'

/** Every skill the agent loads here, grouped by where it comes from. */
export function AgentConfigSkillGroups({
  actions,
  onCreate
}: {
  actions: AgentConfigDocumentRowActions
  onCreate: (collection: AgentConfigCollection) => void
}): React.JSX.Element {
  const t = useTranslate()
  const { layout, snapshot, target, homeScope, apply } = useAgentConfig()
  const groups = agentConfigSkillGroups(layout, homeScope, snapshot.docs)
  // A project page changes this user's settings for the project, never the checked-in ones.
  const writeScope = homeScope === 'user' ? 'user' : 'local'
  const shortPath = (path: string): string =>
    agentConfigShortPath(path, snapshot.homeDir, target.projectPath)

  const setPluginEnabled = (id: string, enabled: boolean): void =>
    void apply(() =>
      layout.skills.plugins === 'claude'
        ? agentConfigApi().setPluginEnabled({ target, scope: writeScope, plugin: id, enabled })
        : agentConfigApi().patchSettings({
            target,
            scope: 'user',
            edits: [{ path: ['plugins', id, 'enabled'], value: enabled }]
          })
    )

  const skillSwitch = (doc: AgentConfigDocRef): ((enabled: boolean) => void) | undefined =>
    layout.skills.switch === 'codex-config' ||
    (layout.skills.switch === 'claude-overrides' && !doc.bundle)
      ? (enabled) =>
          void apply(() =>
            agentConfigApi().setSkillEnabled({
              target,
              scope: writeScope,
              path: doc.path,
              enabled
            })
          )
      : undefined

  const header = (
    group: AgentConfigSkillGroup
  ): { title: string; description: React.ReactNode; action?: React.ReactNode } => {
    if (group.source === 'folder') {
      const folder = `${group.scope === 'user' ? '~/' : ''}${group.collection.dir}`
      return {
        title:
          group.scope === 'user'
            ? t('auto.components.agentConfig.skills.account', 'Account skills')
            : t('auto.components.agentConfig.skills.project', 'Project skills'),
        description: (
          <>
            <span className="font-mono">{folder}</span>
            {group.collection.shared
              ? ` — ${t(
                  'auto.components.agentConfig.skills.shared',
                  'another agent’s folder that {{agent}} reads too',
                  { agent: layout.label }
                )}`
              : null}
          </>
        ),
        action:
          group.scope === homeScope ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-agent-config-new="skill"
              onClick={() => onCreate(group.collection)}
            >
              <Plus />
              {t('auto.components.agentConfig.new', 'New')}
            </Button>
          ) : undefined
      }
    }
    if (group.source === 'builtin') {
      return {
        title: t('auto.components.agentConfig.skills.builtin', 'Built-in skills'),
        description: t(
          'auto.components.agentConfig.skills.builtinDescription',
          'These ship with {{agent}}.',
          { agent: layout.label }
        )
      }
    }
    const { plugin } = group
    return {
      title: t('auto.components.agentConfig.skills.plugin', 'Plugin skills: {{plugin}}', {
        plugin: plugin.name
      }),
      description: (
        <>
          <span className="font-mono">
            {[plugin.id, plugin.version].filter(Boolean).join(' · ')}
          </span>
          {plugin.enabled === false
            ? ` — ${t(
                'auto.components.agentConfig.skills.pluginOff',
                'the plugin is off, so {{agent}} does not load these',
                { agent: layout.label }
              )}`
            : null}
        </>
      ),
      action:
        plugin.enabled === null ? undefined : (
          <Switch
            checked={plugin.enabled}
            aria-label={t('auto.components.agentConfig.plugins.enable', 'Enable {{name}}', {
              name: plugin.name
            })}
            onCheckedChange={(enabled) => setPluginEnabled(plugin.id, enabled)}
          />
        )
    }
  }

  return (
    <>
      {groups.map((group) => {
        const { title, description, action } = header(group)
        const bundled = group.source !== 'folder'
        return (
          <div key={group.key} data-agent-config-skill-group={group.key}>
            <SettingsGroup title={title} description={description} action={action}>
              {group.docs.length === 0 ? (
                <p data-settings-row="" className="py-3 text-xs text-muted-foreground">
                  {t('auto.components.agentConfig.noneHere', 'Nothing here yet.')}
                </p>
              ) : (
                group.docs.map((doc) => (
                  <AgentConfigDocumentRow
                    key={doc.path}
                    doc={doc}
                    showScope={false}
                    actions={actions}
                    location={shortPath(doc.directory ?? doc.path)}
                    readOnly={bundled}
                    dimmed={group.source === 'plugin' && group.plugin.enabled === false}
                    onEnabledChange={skillSwitch(doc)}
                  />
                ))
              )}
            </SettingsGroup>
          </div>
        )
      })}
    </>
  )
}

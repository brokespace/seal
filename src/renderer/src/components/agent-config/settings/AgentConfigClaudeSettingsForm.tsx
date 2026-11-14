import React from 'react'
import { useTranslate } from '@/i18n/use-translate'
import { SettingsRow } from '../../settings/form-controls/SettingsFormControls'
import { SettingsGroup } from '../../settings/section-layout/SettingsGroup'
import { AgentConfigCommitInput } from './AgentConfigCommitInput'
import { AgentConfigEnvField } from './AgentConfigEnvField'
import { AgentConfigHooksField } from './AgentConfigHooksField'
import { AgentConfigChoice, AgentConfigStackedRow } from './AgentConfigSettingRows'
import { AgentConfigStringListField } from './AgentConfigStringListField'
import {
  listAt,
  listEdit,
  textAt,
  textEdit,
  type SettingsFormProps
} from './agent-config-settings-form'

const PERMISSION_MODES = ['default', 'acceptEdits', 'plan', 'bypassPermissions']

export function AgentConfigClaudeSettingsForm({
  value,
  patch
}: SettingsFormProps): React.JSX.Element {
  const t = useTranslate()
  const rules = (
    key: 'allow' | 'ask' | 'deny',
    label: string,
    description: string
  ): React.JSX.Element => (
    <AgentConfigStackedRow label={label} description={description}>
      <AgentConfigStringListField
        label={label}
        items={listAt(value, 'permissions', key)}
        placeholder={t('auto.components.agentConfig.example.rule', 'Bash(npm run test:*)')}
        onChange={(items) => patch([listEdit(['permissions', key], items)])}
      />
    </AgentConfigStackedRow>
  )
  return (
    <>
      <SettingsGroup title={t('auto.components.agentConfig.settings.general', 'General')}>
        <SettingsRow
          label={t('auto.components.agentConfig.settings.model', 'Model')}
          description={t(
            'auto.components.agentConfig.settings.modelDescription',
            'Leave empty to use the default.'
          )}
          control={
            <AgentConfigCommitInput
              className="w-48"
              value={textAt(value, 'model')}
              ariaLabel={t('auto.components.agentConfig.settings.model', 'Model')}
              onCommit={(text) => patch([textEdit(['model'], text)])}
            />
          }
        />
        <SettingsRow
          label={t('auto.components.agentConfig.settings.statusLine', 'Status line command')}
          description={t(
            'auto.components.agentConfig.settings.statusLineDescription',
            'A command whose output Claude Code shows under the prompt.'
          )}
          control={
            <AgentConfigCommitInput
              className="w-64"
              value={textAt(value, 'statusLine', 'command')}
              ariaLabel={t(
                'auto.components.agentConfig.settings.statusLine',
                'Status line command'
              )}
              onCommit={(text) =>
                patch([
                  text === ''
                    ? { path: ['statusLine'], remove: true }
                    : { path: ['statusLine'], value: { type: 'command', command: text } }
                ])
              }
            />
          }
        />
      </SettingsGroup>

      <SettingsGroup
        title={t('auto.components.agentConfig.settings.permissions', 'Permissions')}
        description={t(
          'auto.components.agentConfig.settings.permissionsDescription',
          'Rules name a tool and optionally what it may touch, like Bash(git diff:*) or Read(./secrets/**).'
        )}
      >
        <SettingsRow
          label={t('auto.components.agentConfig.settings.defaultMode', 'Default mode')}
          description={t(
            'auto.components.agentConfig.settings.defaultModeDescription',
            'How a session starts: asking, accepting edits, planning, or skipping permission checks.'
          )}
          control={
            <AgentConfigChoice
              label={t('auto.components.agentConfig.settings.defaultMode', 'Default mode')}
              value={textAt(value, 'permissions', 'defaultMode')}
              options={PERMISSION_MODES}
              onChange={(mode) => patch([textEdit(['permissions', 'defaultMode'], mode)])}
            />
          }
        />
        {rules(
          'allow',
          t('auto.components.agentConfig.settings.allow', 'Allow'),
          t('auto.components.agentConfig.settings.allowDescription', 'Runs without asking.')
        )}
        {rules(
          'ask',
          t('auto.components.agentConfig.settings.ask', 'Ask'),
          t('auto.components.agentConfig.settings.askDescription', 'Always asks first.')
        )}
        {rules(
          'deny',
          t('auto.components.agentConfig.settings.deny', 'Deny'),
          t('auto.components.agentConfig.settings.denyDescription', 'Never runs.')
        )}
        <AgentConfigStackedRow
          label={t('auto.components.agentConfig.settings.directories', 'Additional folders')}
          description={t(
            'auto.components.agentConfig.settings.directoriesDescription',
            'Folders outside the project that Claude Code may work in.'
          )}
        >
          <AgentConfigStringListField
            label={t('auto.components.agentConfig.settings.directories', 'Additional folders')}
            items={listAt(value, 'permissions', 'additionalDirectories')}
            placeholder={t('auto.components.agentConfig.example.extraFolder', '~/notes')}
            onChange={(items) => patch([listEdit(['permissions', 'additionalDirectories'], items)])}
          />
        </AgentConfigStackedRow>
      </SettingsGroup>

      <SettingsGroup
        title={t('auto.components.agentConfig.settings.env', 'Environment')}
        description={t(
          'auto.components.agentConfig.settings.envDescription',
          'Variables set for every session. Values that look like secrets stay hidden; type a new value to replace one.'
        )}
      >
        <div data-settings-row="" className="py-3">
          <AgentConfigEnvField value={value} patch={patch} />
        </div>
      </SettingsGroup>

      <SettingsGroup
        title={t('auto.components.agentConfig.settings.hooks', 'Hooks')}
        description={t(
          'auto.components.agentConfig.settings.hooksDescription',
          'Commands Claude Code runs on the machine when an event happens.'
        )}
      >
        <div data-settings-row="" className="py-3">
          <AgentConfigHooksField value={value} patch={patch} />
        </div>
      </SettingsGroup>
    </>
  )
}

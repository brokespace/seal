import React, { useState } from 'react'
import { Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useTranslate } from '@/i18n/use-translate'
import { isPlainObject } from '../../../../../shared/agent-config/agent-config-values'
import { SettingsRow } from '../../settings/form-controls/SettingsFormControls'
import { SettingsGroup } from '../../settings/section-layout/SettingsGroup'
import { AgentConfigCommitInput } from './AgentConfigCommitInput'
import { AgentConfigChoice } from './AgentConfigSettingRows'
import { textAt, textEdit, type SettingsFormProps } from './agent-config-settings-form'

const APPROVALS = ['untrusted', 'on-failure', 'on-request', 'never']
const SANDBOXES = ['read-only', 'workspace-write', 'danger-full-access']
const EFFORTS = ['minimal', 'low', 'medium', 'high', 'xhigh']

export function AgentConfigCodexSettingsForm({
  value,
  patch
}: SettingsFormProps): React.JSX.Element {
  const t = useTranslate()
  const [newProfile, setNewProfile] = useState('')
  const profiles = isPlainObject(value.profiles) ? Object.keys(value.profiles) : []
  const profileName = newProfile.trim()
  const canAdd = /^[A-Za-z0-9_-]+$/.test(profileName) && !profiles.includes(profileName)
  const labels = {
    model: t('auto.components.agentConfig.settings.model', 'Model'),
    approval: t('auto.components.agentConfig.settings.approval', 'Approval policy'),
    sandbox: t('auto.components.agentConfig.settings.sandbox', 'Sandbox')
  }

  /** The same three choices exist at the top level and inside every profile. */
  const choices = (base: string[]): React.JSX.Element => (
    <>
      <SettingsRow
        label={labels.model}
        description={t(
          'auto.components.agentConfig.settings.modelDescription',
          'Leave empty to use the default.'
        )}
        control={
          <AgentConfigCommitInput
            className="w-48"
            value={textAt(value, ...base, 'model')}
            ariaLabel={labels.model}
            onCommit={(text) => patch([textEdit([...base, 'model'], text)])}
          />
        }
      />
      <SettingsRow
        label={labels.approval}
        description={t(
          'auto.components.agentConfig.settings.approvalDescription',
          'When Codex stops to ask before running a command.'
        )}
        control={
          <AgentConfigChoice
            label={labels.approval}
            value={textAt(value, ...base, 'approval_policy')}
            options={APPROVALS}
            onChange={(next) => patch([textEdit([...base, 'approval_policy'], next)])}
          />
        }
      />
      <SettingsRow
        label={labels.sandbox}
        description={t(
          'auto.components.agentConfig.settings.sandboxDescription',
          'What commands may read and write.'
        )}
        control={
          <AgentConfigChoice
            label={labels.sandbox}
            value={textAt(value, ...base, 'sandbox_mode')}
            options={SANDBOXES}
            onChange={(next) => patch([textEdit([...base, 'sandbox_mode'], next)])}
          />
        }
      />
    </>
  )

  return (
    <>
      <SettingsGroup title={t('auto.components.agentConfig.settings.general', 'General')}>
        {choices([])}
        <SettingsRow
          label={t('auto.components.agentConfig.settings.effort', 'Reasoning effort')}
          control={
            <AgentConfigChoice
              label={t('auto.components.agentConfig.settings.effort', 'Reasoning effort')}
              value={textAt(value, 'model_reasoning_effort')}
              options={EFFORTS}
              onChange={(next) => patch([textEdit(['model_reasoning_effort'], next)])}
            />
          }
        />
        <SettingsRow
          label={t('auto.components.agentConfig.settings.profile', 'Default profile')}
          description={t(
            'auto.components.agentConfig.settings.profileDescription',
            'The profile Codex starts with when none is named.'
          )}
          control={
            <AgentConfigChoice
              label={t('auto.components.agentConfig.settings.profile', 'Default profile')}
              value={textAt(value, 'profile')}
              options={profiles}
              onChange={(next) => patch([textEdit(['profile'], next)])}
            />
          }
        />
      </SettingsGroup>

      {profiles.map((name) => (
        <SettingsGroup
          key={name}
          title={t('auto.components.agentConfig.settings.profileTitle', 'Profile: {{name}}', {
            name
          })}
          action={
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-agent-config-profile-remove={name}
              onClick={() =>
                patch([
                  { path: ['profiles', name], remove: true },
                  ...(textAt(value, 'profile') === name
                    ? [{ path: ['profile'], remove: true as const }]
                    : [])
                ])
              }
            >
              <X />
              {t('auto.components.agentConfig.settings.removeProfile', 'Remove')}
            </Button>
          }
        >
          {choices(['profiles', name])}
        </SettingsGroup>
      ))}

      <div className="flex items-center gap-2">
        <Input
          value={newProfile}
          placeholder={t('auto.components.agentConfig.settings.profileName', 'profile name')}
          aria-label={t('auto.components.agentConfig.settings.newProfile', 'New profile name')}
          variant="code"
          className="h-7 w-48"
          onChange={(event) => setNewProfile(event.target.value)}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!canAdd}
          data-agent-config-profile-add=""
          onClick={() => {
            // A profile needs one key to exist as a table; the approval default is the safe one.
            patch([{ path: ['profiles', profileName, 'approval_policy'], value: 'on-request' }])
            setNewProfile('')
          }}
        >
          <Plus />
          {t('auto.components.agentConfig.settings.addProfile', 'Add profile')}
        </Button>
      </div>
    </>
  )
}

import React, { useState } from 'react'
import { FileCode } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTranslate } from '@/i18n/use-translate'
import type {
  AgentConfigScope,
  AgentConfigSettingsEdit
} from '../../../../../shared/agent-config/agent-config-types'
import { validationKindForPath } from '../../../../../shared/agent-config/agent-config-validation'
import { SettingsSegmentedControl } from '../../settings/form-controls/SettingsFormControls'
import {
  AgentConfigDocumentSheet,
  type AgentConfigOpenDocument
} from '../documents/AgentConfigDocumentSheet'
import { agentConfigApi } from '../model/agent-config-client'
import { useAgentConfig } from '../model/agent-config-context'
import { agentConfigScopeHint, agentConfigScopeLabel } from '../model/agent-config-scope-labels'
import { AgentConfigClaudeSettingsForm } from './AgentConfigClaudeSettingsForm'
import { AgentConfigCodexSettingsForm } from './AgentConfigCodexSettingsForm'

/** Keys the forms cover; anything else in the file is listed so nobody thinks it is gone. */
const FORM_KEYS: Record<string, readonly string[]> = {
  claude: ['model', 'statusLine', 'permissions', 'env', 'hooks', 'enabledPlugins'],
  codex: [
    'model',
    'model_reasoning_effort',
    'approval_policy',
    'sandbox_mode',
    'profile',
    'profiles'
  ]
}

export function AgentConfigSettingsSection(): React.JSX.Element {
  const t = useTranslate()
  const { snapshot, layout, target, homeScope, apply } = useAgentConfig()
  const [picked, setPicked] = useState<AgentConfigScope>(homeScope)
  const [raw, setRaw] = useState<AgentConfigOpenDocument | null>(null)
  const layers = snapshot.settings
  const layer = layers.find((item) => item.scope === picked) ?? layers[0]

  if (!layer) {
    return (
      <p className="text-xs text-muted-foreground" data-agent-config-section="settings">
        {t(
          'auto.components.agentConfig.settings.noFile',
          '{{agent}} has no settings file Seal knows here. Its files are under Files & backups.',
          { agent: layout.label }
        )}
      </p>
    )
  }

  const patch = (edits: AgentConfigSettingsEdit[]): void =>
    void apply(() => agentConfigApi().patchSettings({ target, scope: layer.scope, edits }))
  const openRaw = (): void =>
    setRaw({
      path: layer.path,
      title: layer.path.split(/[\\/]/).at(-1) ?? layer.path,
      validation: validationKindForPath(layer.path),
      scope: layer.scope
    })
  const formKeys = FORM_KEYS[layout.id]
  const otherKeys = Object.keys(layer.value ?? {}).filter((key) => !formKeys?.includes(key))
  const value = layer.value ?? {}

  return (
    <div className="space-y-6" data-agent-config-section="settings">
      <div className="flex flex-wrap items-center gap-3">
        {layers.length > 1 ? (
          <SettingsSegmentedControl
            size="sm"
            value={layer.scope}
            onChange={setPicked}
            ariaLabel={t('auto.components.agentConfig.settings.scope', 'Settings file')}
            options={layers.map((item) => ({
              value: item.scope,
              label: agentConfigScopeLabel(item.scope, t)
            }))}
          />
        ) : null}
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-xs text-muted-foreground" title={layer.path}>
            {layer.path}
            {layer.exists
              ? ''
              : ` — ${t('auto.components.agentConfig.settings.notCreated', 'created on first change')}`}
          </p>
          <p className="text-xs text-muted-foreground">{agentConfigScopeHint(layer.scope, t)}</p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-agent-config-raw=""
          onClick={openRaw}
        >
          <FileCode />
          {t('auto.components.agentConfig.settings.editRaw', 'Edit file')}
        </Button>
      </div>

      {layer.error ? (
        <p className="text-xs text-destructive [overflow-wrap:anywhere]" role="alert">
          {t(
            'auto.components.agentConfig.settings.unreadable',
            'This file cannot be read as settings, so the form is off until it is fixed: {{error}}',
            { error: layer.error }
          )}
        </p>
      ) : layout.id === 'claude' ? (
        <AgentConfigClaudeSettingsForm value={value} patch={patch} />
      ) : layout.id === 'codex' ? (
        <AgentConfigCodexSettingsForm value={value} patch={patch} />
      ) : (
        <p className="text-xs text-muted-foreground">
          {t(
            'auto.components.agentConfig.settings.rawOnly',
            'Seal has no form for {{agent}} settings yet. Edit the file directly; it is checked and backed up the same way.',
            { agent: layout.label }
          )}
        </p>
      )}

      {formKeys && !layer.error && otherKeys.length > 0 ? (
        <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
          {t(
            'auto.components.agentConfig.settings.otherKeys',
            'Also in this file, left as written: {{keys}}. Use Edit file to change them.',
            { keys: otherKeys.join(', ') }
          )}
        </p>
      ) : null}

      <AgentConfigDocumentSheet document={raw} onClose={() => setRaw(null)} />
    </div>
  )
}

import React, { useState } from 'react'
import { Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useTranslate } from '@/i18n/use-translate'
import { AGENT_CONFIG_SECRET_MASK } from '../../../../../shared/agent-config/agent-config-types'
import { stringRecord } from '../../../../../shared/agent-config/agent-config-values'
import { AgentConfigCommitInput } from './AgentConfigCommitInput'
import type { SettingsFormProps } from './agent-config-settings-form'

/** Environment variables, one write per variable so a hidden value is never sent back. */
export function AgentConfigEnvField({ value, patch }: SettingsFormProps): React.JSX.Element {
  const t = useTranslate()
  const env = stringRecord(value.env)
  const [name, setName] = useState('')
  const [text, setText] = useState('')
  const validName = /^[A-Za-z_][A-Za-z0-9_]*$/.test(name.trim())
  const add = (): void => {
    if (!validName) {
      return
    }
    patch([{ path: ['env', name.trim()], value: text }])
    setName('')
    setText('')
  }
  return (
    <div className="space-y-1.5">
      {Object.entries(env).map(([key, stored]) => (
        <div key={key} className="flex items-center gap-2" data-agent-config-env={key}>
          <span className="w-2/5 truncate font-mono text-xs" title={key}>
            {key}
          </span>
          <AgentConfigCommitInput
            value={stored}
            className="min-w-0 flex-1"
            ariaLabel={t('auto.components.agentConfig.settings.envValue', 'Value of {{name}}', {
              name: key
            })}
            onCommit={(next) => {
              // The mask stands for a value this window never received.
              if (next !== AGENT_CONFIG_SECRET_MASK) {
                patch([{ path: ['env', key], value: next }])
              }
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={t('auto.components.agentConfig.pairs.remove', 'Remove {{name}}', {
              name: key
            })}
            onClick={() => patch([{ path: ['env', key], remove: true }])}
          >
            <X />
          </Button>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <Input
          value={name}
          placeholder={t('auto.components.agentConfig.example.variable', 'NAME')}
          aria-label={t('auto.components.agentConfig.settings.envName', 'New variable name')}
          variant="code"
          className="h-7 w-2/5"
          onChange={(event) => setName(event.target.value)}
        />
        <Input
          value={text}
          placeholder={t('auto.components.agentConfig.value', 'value')}
          aria-label={t('auto.components.agentConfig.settings.envNewValue', 'New variable value')}
          variant="code"
          className="h-7 min-w-0 flex-1"
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              add()
            }
          }}
        />
        <Button type="button" variant="outline" size="xs" disabled={!validName} onClick={add}>
          <Plus />
          {t('auto.components.agentConfig.pairs.add', 'Add')}
        </Button>
      </div>
    </div>
  )
}

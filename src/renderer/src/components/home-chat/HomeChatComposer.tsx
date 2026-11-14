import { useState } from 'react'
import { ArrowUp, Square } from 'lucide-react'
import { useTranslate } from '@/i18n/use-translate'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { Textarea } from '../ui/textarea'
import {
  HOME_CHAT_BACKEND_KINDS,
  type HomeChatAccountOption,
  type HomeChatBackendKind,
  type HomeChatSettings,
  type HomeChatSummary
} from '../../../../shared/home-chat/home-chat-types'
import { HomeChatSettingsPopover } from './HomeChatSettingsPopover'
import type { HomeChatState } from './use-home-chat'

const DEFAULT_ACCOUNT_VALUE = '__default__'

type ComposerProps = {
  chat: HomeChatSummary | null
  settings: HomeChatSettings | null
  accounts: HomeChatAccountOption[]
  onSend: (text: string) => Promise<boolean>
  onStop: () => void
  onUpdate: HomeChatState['updateChat']
  onSaveSettings: HomeChatState['saveSettings']
  onOpenAccounts: () => void
}

export function HomeChatComposer({
  chat,
  settings,
  accounts,
  onSend,
  onStop,
  onUpdate,
  onSaveSettings,
  onOpenAccounts
}: ComposerProps): React.JSX.Element {
  const t = useTranslate()
  const [draft, setDraft] = useState('')
  const running = chat?.status === 'running'
  const backend: HomeChatBackendKind = chat?.backend ?? settings?.defaultBackend ?? 'claude-code'

  const submit = async (): Promise<void> => {
    const text = draft.trim()
    if (!text || running) {
      return
    }
    setDraft('')
    if (!(await onSend(text))) {
      setDraft(text)
    }
  }

  return (
    <div className="border-t border-border px-4 pt-3 pb-3">
      <Textarea
        value={draft}
        rows={2}
        className="max-h-48 min-h-14 resize-none"
        placeholder={t('homeChat.placeholder', 'Ask Seal to do something on any of your machines…')}
        aria-label={t('homeChat.messageLabel', 'Message')}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault()
            void submit()
          }
        }}
      />
      <div className="mt-2 flex items-center gap-1.5">
        <Select
          value={backend}
          disabled={running}
          onValueChange={(value) =>
            void onUpdate({
              backend: HOME_CHAT_BACKEND_KINDS.find((kind) => kind === value) ?? 'claude-code',
              accountId: null
            })
          }
        >
          <SelectTrigger size="sm" aria-label={t('homeChat.backend.label', 'Model source')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="claude-code">{t('homeChat.backend.claude', 'Claude')}</SelectItem>
            <SelectItem value="codex">{t('homeChat.backend.codex', 'Codex')}</SelectItem>
            <SelectItem value="openai-compatible">
              {t('homeChat.backend.openai', 'Model API')}
            </SelectItem>
          </SelectContent>
        </Select>

        {backend === 'openai-compatible' ? (
          <Input
            key={chat?.id}
            defaultValue={chat?.model ?? ''}
            disabled={running}
            placeholder={settings?.openai.model || t('homeChat.model.placeholder', 'Model')}
            aria-label={t('homeChat.model.label', 'Model')}
            className="h-8 w-40"
            onBlur={(event) => {
              const value = event.target.value.trim()
              if (value !== (chat?.model ?? '')) {
                void onUpdate({ model: value || null })
              }
            }}
          />
        ) : (
          <Select
            value={chat?.accountId ?? DEFAULT_ACCOUNT_VALUE}
            disabled={running}
            onOpenChange={(open) => open && onOpenAccounts()}
            onValueChange={(value) =>
              void onUpdate({ accountId: value === DEFAULT_ACCOUNT_VALUE ? null : value })
            }
          >
            <SelectTrigger
              size="sm"
              className="max-w-48"
              aria-label={t('homeChat.account.label', 'Account')}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {accounts
                .filter((account) => account.backend === backend)
                .map((account) => (
                  <SelectItem
                    key={account.id ?? DEFAULT_ACCOUNT_VALUE}
                    value={account.id ?? DEFAULT_ACCOUNT_VALUE}
                  >
                    {account.id === null
                      ? t('homeChat.account.system', 'System login')
                      : account.label}
                    {account.detail && (
                      <span className="text-muted-foreground"> · {account.detail}</span>
                    )}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        )}

        <HomeChatSettingsPopover settings={settings} onSave={onSaveSettings} />

        <div className="flex-1" />
        {running ? (
          <Button
            size="icon-xs"
            variant="secondary"
            onClick={onStop}
            aria-label={t('homeChat.stop', 'Stop')}
            data-home-chat-stop
          >
            <Square className="fill-current" />
          </Button>
        ) : (
          <Button
            size="icon-xs"
            onClick={() => void submit()}
            disabled={!draft.trim()}
            aria-label={t('homeChat.send', 'Send')}
          >
            <ArrowUp />
          </Button>
        )}
      </div>
    </div>
  )
}

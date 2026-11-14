import { useState } from 'react'
import { Settings2 } from 'lucide-react'
import { useTranslate } from '@/i18n/use-translate'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover'
import { Separator } from '../ui/separator'
import type {
  HomeChatSettings,
  HomeChatSettingsUpdate
} from '../../../../shared/home-chat/home-chat-types'
import { HomeChatWebSearchFields, type HomeChatWebSearchDraft } from './HomeChatWebSearchFields'

const BASE_URL_EXAMPLE = 'https://openrouter.ai/api/v1'
const MODEL_EXAMPLE = 'anthropic/claude-sonnet-4.5'

/** The model API the non-Claude backend calls: any OpenAI-compatible Chat Completions endpoint. */
export function HomeChatSettingsPopover({
  settings,
  onSave
}: {
  settings: HomeChatSettings | null
  onSave: (update: HomeChatSettingsUpdate) => Promise<boolean>
}): React.JSX.Element {
  const t = useTranslate()
  const [open, setOpen] = useState(false)
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [contextWindow, setContextWindow] = useState('')
  const [web, setWeb] = useState<HomeChatWebSearchDraft>({
    searchProvider: 'duckduckgo',
    searxngUrl: '',
    apiKey: ''
  })
  const [saving, setSaving] = useState(false)

  const onOpenChange = (next: boolean): void => {
    if (next && settings) {
      setBaseUrl(settings.openai.baseUrl)
      setModel(settings.openai.model)
      setApiKey('')
      setContextWindow(String(settings.openai.contextWindow))
      setWeb({
        searchProvider: settings.web.searchProvider,
        searxngUrl: settings.web.searxngUrl,
        apiKey: ''
      })
    }
    setOpen(next)
  }

  const save = async (): Promise<void> => {
    setSaving(true)
    const saved = await onSave({
      openai: {
        baseUrl,
        model,
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        ...(Number(contextWindow) > 0 ? { contextWindow: Number(contextWindow) } : {})
      },
      web: {
        searchProvider: web.searchProvider,
        searxngUrl: web.searxngUrl,
        ...(web.apiKey.trim() ? { apiKey: web.apiKey.trim() } : {})
      }
    })
    setSaving(false)
    if (saved) {
      setOpen(false)
    }
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label={t('homeChat.settings.openAssistant', 'Assistant settings')}
        >
          <Settings2 />
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-80">
        <div className="scrollbar-sleek max-h-[75vh] space-y-3 overflow-y-auto">
          <div className="space-y-0.5">
            <p className="text-sm font-medium">{t('homeChat.settings.title', 'Model API')}</p>
            <p className="text-xs text-muted-foreground">
              {t(
                'homeChat.settings.description',
                'Used by chats set to Model API: any OpenAI-compatible endpoint such as OpenRouter, xAI, OpenAI or a local server.'
              )}
            </p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="home-chat-base-url">{t('homeChat.settings.baseUrl', 'Base URL')}</Label>
            <Input
              id="home-chat-base-url"
              value={baseUrl}
              placeholder={BASE_URL_EXAMPLE}
              variant="code"
              className="h-8"
              onChange={(event) => setBaseUrl(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="home-chat-model">{t('homeChat.settings.model', 'Default model')}</Label>
            <Input
              id="home-chat-model"
              value={model}
              placeholder={MODEL_EXAMPLE}
              variant="code"
              className="h-8"
              onChange={(event) => setModel(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="home-chat-api-key">{t('homeChat.settings.apiKey', 'API key')}</Label>
            <Input
              id="home-chat-api-key"
              type="password"
              value={apiKey}
              autoComplete="off"
              placeholder={
                settings?.openai.apiKeyConfigured
                  ? t('homeChat.settings.apiKeySaved', 'Saved — type to replace')
                  : t('homeChat.settings.apiKeyOptional', 'Optional for local servers')
              }
              className="h-8"
              onChange={(event) => setApiKey(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="home-chat-context-window">
              {t('homeChat.settings.contextWindow', 'Context window (tokens)')}
            </Label>
            <Input
              id="home-chat-context-window"
              inputMode="numeric"
              value={contextWindow}
              variant="code"
              className="h-8"
              onChange={(event) => setContextWindow(event.target.value.replace(/\D/g, ''))}
            />
            <p className="text-xs text-muted-foreground">
              {t(
                'homeChat.settings.contextWindowHint',
                'Seal summarizes older messages for the model before this fills.'
              )}
            </p>
          </div>
          <Separator />
          <HomeChatWebSearchFields
            draft={web}
            keySaved={settings?.web.searchApiKeyConfigured ?? false}
            onChange={setWeb}
          />
          <div className="flex justify-between gap-2">
            {settings?.openai.apiKeyConfigured ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={saving}
                onClick={() => void onSave({ openai: { apiKey: null } })}
              >
                {t('homeChat.settings.clearKey', 'Remove key')}
              </Button>
            ) : (
              <span />
            )}
            <Button size="sm" disabled={saving} onClick={() => void save()}>
              {t('homeChat.settings.save', 'Save')}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

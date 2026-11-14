import { useTranslate } from '@/i18n/use-translate'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import type { HomeChatSearchProvider } from '../../../../shared/home-chat/home-chat-types'

export type HomeChatWebSearchDraft = {
  searchProvider: HomeChatSearchProvider
  searxngUrl: string
  apiKey: string
}

const PROVIDER_NAMES: Record<HomeChatSearchProvider, string> = {
  duckduckgo: 'DuckDuckGo',
  brave: 'Brave Search',
  tavily: 'Tavily',
  searxng: 'SearXNG'
}
const PROVIDERS = Object.keys(PROVIDER_NAMES).filter(
  (key): key is HomeChatSearchProvider => key in PROVIDER_NAMES
)
const SEARXNG_EXAMPLE = 'https://searx.example.com'

/** Which engine web_search uses; web_fetch needs none of this. */
export function HomeChatWebSearchFields({
  draft,
  keySaved,
  onChange
}: {
  draft: HomeChatWebSearchDraft
  keySaved: boolean
  onChange: (draft: HomeChatWebSearchDraft) => void
}): React.JSX.Element {
  const t = useTranslate()
  const needsKey = draft.searchProvider === 'brave' || draft.searchProvider === 'tavily'
  return (
    <div className="space-y-3">
      <div className="space-y-0.5">
        <p className="text-sm font-medium">{t('homeChat.web.title', 'Web search')}</p>
        <p className="text-xs text-muted-foreground">
          {t(
            'homeChat.web.description',
            'DuckDuckGo works without a key; the others are more reliable.'
          )}
        </p>
      </div>
      <div className="space-y-1">
        <Label htmlFor="home-chat-search-provider">{t('homeChat.web.provider', 'Provider')}</Label>
        <Select
          value={draft.searchProvider}
          onValueChange={(value) => {
            const provider = PROVIDERS.find((p) => p === value)
            if (provider) {
              onChange({ ...draft, searchProvider: provider })
            }
          }}
        >
          <SelectTrigger id="home-chat-search-provider" size="sm" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PROVIDERS.map((provider) => (
              <SelectItem key={provider} value={provider}>
                {PROVIDER_NAMES[provider]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {draft.searchProvider === 'searxng' && (
        <div className="space-y-1">
          <Label htmlFor="home-chat-searxng-url">
            {t('homeChat.web.searxngUrl', 'SearXNG URL')}
          </Label>
          <Input
            id="home-chat-searxng-url"
            value={draft.searxngUrl}
            placeholder={SEARXNG_EXAMPLE}
            variant="code"
            className="h-8"
            onChange={(event) => onChange({ ...draft, searxngUrl: event.target.value })}
          />
        </div>
      )}
      {needsKey && (
        <div className="space-y-1">
          <Label htmlFor="home-chat-search-key">{t('homeChat.web.apiKey', 'Search API key')}</Label>
          <Input
            id="home-chat-search-key"
            type="password"
            value={draft.apiKey}
            autoComplete="off"
            placeholder={
              keySaved
                ? t('homeChat.settings.apiKeySaved', 'Saved — type to replace')
                : t('homeChat.web.apiKeyRequired', 'Required for this provider')
            }
            className="h-8"
            onChange={(event) => onChange({ ...draft, apiKey: event.target.value })}
          />
        </div>
      )}
    </div>
  )
}

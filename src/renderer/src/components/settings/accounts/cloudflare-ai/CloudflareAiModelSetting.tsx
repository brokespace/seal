import { useTranslate } from '@/i18n/use-translate'
import {
  CLOUDFLARE_AI_DEFAULT_FALLBACK_MODEL,
  CLOUDFLARE_AI_DEFAULT_MODEL
} from '../../../../../../shared/utility-model/utility-model-types'
import { Label } from '../../../ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../ui/select'
import { SearchableSetting } from '../../section-layout/SearchableSetting'
import { CLOUDFLARE_AI_SEARCH_KEYWORDS } from './cloudflare-ai-search'
import type { CloudflareAiSettingsModel } from './use-cloudflare-ai-settings'
import { utilityModelFailureText } from './utility-model-failure-text'

function ModelSelect({
  id,
  value,
  options,
  unavailable,
  disabled,
  onChange
}: {
  id: string
  value: string
  options: readonly string[]
  unavailable: ReadonlySet<string>
  disabled: boolean
  onChange: (model: string) => void
}): React.JSX.Element {
  const t = useTranslate()
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger id={id} size="sm" className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option} value={option}>
            {option}
            {unavailable.has(option) ? (
              <span className="text-muted-foreground">
                {' · '}
                {t('seal.cloudflareAi.model.notOnPlan', 'paid plan')}
              </span>
            ) : null}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** Pick the model and its fallback from the account's own text-generation catalog. */
export function CloudflareAiModelSetting({
  model,
  editable
}: {
  model: CloudflareAiSettingsModel
  editable: boolean
}): React.JSX.Element | null {
  const t = useTranslate()
  const { status, models, modelsFailure, busy } = model
  if (!status) {
    return null
  }
  // The saved and recommended models stay selectable while the catalog loads or cannot be read.
  const options = [
    ...new Set([
      status.model,
      status.fallbackModel,
      CLOUDFLARE_AI_DEFAULT_MODEL,
      CLOUDFLARE_AI_DEFAULT_FALLBACK_MODEL,
      ...models.map((entry) => entry.id)
    ])
  ]
  const unavailable = new Set(
    status.unavailableModels.flatMap((failure) => (failure.model ? [failure.model] : []))
  )
  const disabled = busy || !editable
  const title = t('seal.cloudflareAi.model.title', 'Model')
  return (
    <SearchableSetting
      title={title}
      description={t(
        'seal.cloudflareAi.model.description',
        'The Workers AI model that writes summaries, and the one used when it is unavailable.'
      )}
      keywords={CLOUDFLARE_AI_SEARCH_KEYWORDS}
      className="space-y-2 py-3"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor="cloudflare-ai-model">{title}</Label>
          <ModelSelect
            id="cloudflare-ai-model"
            value={status.model}
            options={options}
            unavailable={unavailable}
            disabled={disabled}
            onChange={(value) => value !== status.model && void model.save({ model: value })}
          />
        </div>
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor="cloudflare-ai-fallback-model">
            {t('seal.cloudflareAi.model.fallbackTitle', 'Fallback model')}
          </Label>
          <ModelSelect
            id="cloudflare-ai-fallback-model"
            value={status.fallbackModel}
            options={options}
            unavailable={unavailable}
            disabled={disabled}
            onChange={(value) =>
              value !== status.fallbackModel && void model.save({ fallbackModel: value })
            }
          />
        </div>
      </div>
      {status.unavailableModels.map((failure) => (
        <p key={failure.model ?? failure.kind} className="text-xs text-status-warning">
          {utilityModelFailureText(failure, t)}{' '}
          {failure.model === status.model && !unavailable.has(status.fallbackModel)
            ? t('seal.cloudflareAi.model.usingFallback', 'Summaries use {{model}} instead.', {
                model: status.fallbackModel
              })
            : null}
        </p>
      ))}
      <p className="text-xs text-muted-foreground">
        {modelsFailure
          ? t(
              'seal.cloudflareAi.model.catalogFailed',
              'Could not load the model list: {{reason}}',
              { reason: utilityModelFailureText(modelsFailure, t) }
            )
          : t(
              'seal.cloudflareAi.model.help',
              'GLM 4.7 Flash answers in about half a second and fits roughly 7,000 summaries a day in the Workers Free allocation.'
            )}
      </p>
    </SearchableSetting>
  )
}

import { useTranslate } from '@/i18n/use-translate'
import {
  UTILITY_MODEL_PROVIDERS,
  utilityModelProvider
} from '../../../../../shared/utility-model/utility-model-provider-catalog'
import type {
  UtilityModelChoice,
  UtilityModelTask
} from '../../../../../shared/utility-model/utility-model-selection'
import type {
  UtilityModelCatalogEntry,
  UtilityModelProviderId
} from '../../../../../shared/utility-model/utility-model-types'
import { UtilityModelAccountStatus } from '../accounts/utility-model/UtilityModelAccountStatus'
import { utilityModelFailureText } from '../accounts/utility-model/utility-model-failure-text'
import { Button } from '../../ui/button'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue
} from '../../ui/select'
import { SettingsRow } from '../form-controls/SettingsFormControls'
import { SearchableSetting } from '../section-layout/SearchableSetting'
import { SESSION_SUMMARIES_SEARCH_KEYWORDS } from './session-summaries-settings-search'
import { UtilityModelPicker } from './UtilityModelPicker'
import type { SessionSummarySettingsModel } from './use-session-summary-settings'

const API_PROVIDERS = UTILITY_MODEL_PROVIDERS.filter((provider) => provider.kind === 'api')
const CLI_PROVIDERS = UTILITY_MODEL_PROVIDERS.filter((provider) => provider.kind === 'agent-cli')

function mergeEntries(
  ...lists: readonly (readonly UtilityModelCatalogEntry[])[]
): UtilityModelCatalogEntry[] {
  const byId = new Map<string, UtilityModelCatalogEntry>()
  for (const entry of lists.flat()) {
    // The provider's own list comes last and knows more than the names Seal ships with.
    byId.set(entry.id, { ...byId.get(entry.id), ...entry })
  }
  return [...byId.values()]
}

/** The provider, model and fallback one task runs on, with that provider's state and a live test. */
export function UtilityModelChoiceRows({
  task,
  choice,
  model,
  editable,
  canTest,
  onChange,
  onOpenAccounts
}: {
  task: UtilityModelTask
  choice: UtilityModelChoice
  model: SessionSummarySettingsModel
  editable: boolean
  canTest: boolean
  onChange: (choice: UtilityModelChoice) => void
  onOpenAccounts: (provider: UtilityModelProviderId) => void
}): React.JSX.Element {
  const t = useTranslate()
  const descriptor = utilityModelProvider(choice.provider)
  const provider = descriptor.label
  const status = model.providers.find((entry) => entry.provider === choice.provider) ?? null
  const catalog = model.catalogs[choice.provider]
  const defaults = status?.defaultModels ?? []
  const entries = mergeEntries(
    descriptor.models,
    defaults.map((id) => ({ id, description: null })),
    catalog?.models ?? []
  )
  const unavailable = new Set(
    (status?.unavailableModels ?? []).flatMap((failure) => (failure.model ? [failure.model] : []))
  )
  const defaultModel = defaults[0] ?? descriptor.defaultModel
  const defaultFallback = defaults.find((id) => id !== (choice.model ?? defaultModel)) ?? null
  const disabled = !editable || model.saving
  const cli = descriptor.kind === 'agent-cli'
  const configured = status?.configured === true
  const providerTitle = t('seal.summaryModels.provider.title', 'Provider')
  const modelTitle = t('seal.summaryModels.model.title', 'Model')
  const fallbackTitle = t('seal.summaryModels.fallback.title', 'Fallback model')
  const notSetUp = (id: UtilityModelProviderId): boolean =>
    model.providers.some((entry) => entry.provider === id && !entry.configured)

  return (
    <>
      <SearchableSetting
        title={providerTitle}
        description={t(
          'seal.summaryModels.search.description',
          'Choose the provider and model that write session summaries and recaps: Cloudflare Workers AI, OpenRouter, MiniMax, or the Claude, Codex, Grok, Antigravity or Devin CLI.'
        )}
        keywords={SESSION_SUMMARIES_SEARCH_KEYWORDS}
      >
        <SettingsRow
          label={providerTitle}
          description={
            <>
              {cli
                ? t(
                    'seal.summaryModels.provider.cliHelp',
                    'Runs the {{provider}} CLI once per request, on the account it is signed into. Each run starts an agent process: slower than an API, and it counts against that plan’s limits.',
                    { provider }
                  )
                : t(
                    'seal.summaryModels.provider.apiHelp',
                    'Calls {{provider}} with the account saved in Accounts.',
                    { provider }
                  )}{' '}
              <Button
                variant="link"
                size="xs"
                className="h-auto p-0 text-xs"
                onClick={() => onOpenAccounts(choice.provider)}
              >
                {t('seal.summaryModels.provider.openAccounts', 'Open Accounts')}
              </Button>
            </>
          }
          control={
            <Select
              value={choice.provider}
              disabled={disabled}
              onValueChange={(next) =>
                next !== choice.provider &&
                onChange({
                  provider: next as UtilityModelProviderId,
                  model: null,
                  fallbackModel: null
                })
              }
            >
              <SelectTrigger size="sm" className="min-w-[220px]" aria-label={providerTitle}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                {[
                  {
                    key: 'api',
                    heading: t('seal.summaryModels.provider.apiGroup', 'API'),
                    providers: API_PROVIDERS
                  },
                  {
                    key: 'cli',
                    heading: t('seal.summaryModels.provider.cliGroup', 'Agent CLI subscription'),
                    providers: CLI_PROVIDERS
                  }
                ].map((group) => (
                  <SelectGroup key={group.key}>
                    <SelectLabel>{group.heading}</SelectLabel>
                    {group.providers.map((entry) => (
                      <SelectItem key={entry.id} value={entry.id}>
                        {entry.label}
                        {notSetUp(entry.id) ? (
                          <span className="text-muted-foreground">
                            {' · '}
                            {t('seal.summaryModels.provider.notSetUp', 'not set up')}
                          </span>
                        ) : null}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
          }
        />
      </SearchableSetting>

      <SettingsRow
        label={modelTitle}
        description={
          cli
            ? t(
                'seal.summaryModels.model.cliHelp',
                'A model name the {{provider}} CLI accepts. A small, fast one keeps each run cheap.',
                { provider }
              )
            : t(
                'seal.summaryModels.model.apiHelp',
                'Pick from {{provider}}’s list, or type any model id it offers.',
                { provider }
              )
        }
        control={
          <UtilityModelPicker
            ariaLabel={modelTitle}
            value={choice.model}
            automaticLabel={t('seal.summaryModels.model.default', 'Default · {{model}}', {
              model: defaultModel
            })}
            entries={entries}
            unavailable={unavailable}
            loading={catalog?.loading === true}
            disabled={disabled}
            onOpen={() => model.loadModels(choice.provider)}
            onChange={(next) => onChange({ ...choice, model: next })}
          />
        }
      />
      <SettingsRow
        label={fallbackTitle}
        description={t(
          'seal.summaryModels.fallback.help',
          'Tried when the model is rate limited, unavailable on the account’s plan, or gone.'
        )}
        control={
          <UtilityModelPicker
            ariaLabel={fallbackTitle}
            value={choice.fallbackModel}
            automaticLabel={
              defaultFallback
                ? t('seal.summaryModels.model.default', 'Default · {{model}}', {
                    model: defaultFallback
                  })
                : t('seal.summaryModels.fallback.none', 'None')
            }
            entries={entries}
            unavailable={unavailable}
            loading={catalog?.loading === true}
            disabled={disabled}
            onOpen={() => model.loadModels(choice.provider)}
            onChange={(next) => onChange({ ...choice, fallbackModel: next })}
          />
        }
      />
      {catalog?.failure ? (
        <p className="pb-2 text-xs text-muted-foreground">
          {t('seal.cloudflareAi.model.catalogFailed', 'Could not load the model list: {{reason}}', {
            reason: utilityModelFailureText(catalog.failure, t, choice.provider)
          })}
        </p>
      ) : null}
      {(status?.unavailableModels ?? []).map((failure) => (
        <p key={failure.model ?? failure.kind} className="pb-2 text-xs text-status-warning">
          {utilityModelFailureText(failure, t, choice.provider)}
        </p>
      ))}

      <UtilityModelAccountStatus
        provider={choice.provider}
        configured={configured}
        title={
          status === null
            ? null
            : configured
              ? t('seal.summaryModels.status.ready', '{{provider}} is set up on this host', {
                  provider
                })
              : cli
                ? t(
                    'seal.utilityModel.failure.cliMissing',
                    'The {{provider}} CLI was not found on this host.',
                    {
                      provider
                    }
                  )
                : t('seal.summaryModels.status.notSetUp', '{{provider}} is not set up yet', {
                    provider
                  })
        }
        detail={
          status === null || configured
            ? t(
                'seal.summaryModels.status.testHelp',
                'Test sends one short request through the model chosen here.'
              )
            : cli
              ? t(
                  'seal.summaryModels.status.cliSetup',
                  'Install {{provider}} and sign in on this host, then come back.',
                  { provider }
                )
              : t(
                  'seal.summaryModels.status.apiSetup',
                  'Save its account in Accounts; nothing is written until then.'
                )
        }
        pausedUntil={status?.pausedUntil ?? null}
        testResult={model.testResults[task] ?? null}
        testing={model.testing === task}
        canTest={canTest && configured && model.testing === null}
        onTest={() => void model.test(task)}
      />
    </>
  )
}

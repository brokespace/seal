import { isWebClientLocation } from '@/app-shell/platform/web-client-location'
import { useTranslate } from '@/i18n/use-translate'
import { useAppStore } from '../../../store/index'
import { utilityModelProvider } from '../../../../../shared/utility-model/utility-model-provider-catalog'
import {
  utilityModelChoiceFor,
  type UtilityModelChoice
} from '../../../../../shared/utility-model/utility-model-selection'
import type { UtilityModelProviderId } from '../../../../../shared/utility-model/utility-model-types'
import type { UsageCredentialHost } from '../accounts/usage/usage-credential-host'
import { SettingsSwitchRow } from '../form-controls/SettingsFormControls'
import { SearchableSetting } from '../section-layout/SearchableSetting'
import { SettingsGroup } from '../section-layout/SettingsGroup'
import { SESSION_SUMMARIES_SEARCH_KEYWORDS } from './session-summaries-settings-search'
import { UtilityModelChoiceRows } from './UtilityModelChoiceRows'
import { useSessionSummarySettings } from './use-session-summary-settings'
import { settingsAccountsSectionForUtilityProvider } from './utility-provider-accounts-section'

/** Turns session summaries and recaps on, and picks the provider and model each runs on, for one host. */
export function SessionSummariesSettingsPane({
  host
}: {
  host: UsageCredentialHost
}): React.JSX.Element {
  const t = useTranslate()
  const openSettingsTarget = useAppStore((state) => state.openSettingsTarget)
  const onOpenAccounts = (provider: UtilityModelProviderId): void =>
    openSettingsTarget({
      pane: 'accounts',
      repoId: null,
      sectionId: settingsAccountsSectionForUtilityProvider(provider)
    })
  const model = useSessionSummarySettings(host.owner)
  const { status, models, access } = model
  const loaded = status !== null
  const editable = loaded && access === 'ready'
  const canTest = editable && !isWebClientLocation()
  const summariesTitle = t('seal.sessionSummaries.setting.title', 'Session summaries')
  const recapTitle = t('seal.sessionRecap.setting.title', 'Session recaps')
  const separateTitle = t('seal.summaryModels.separate.title', 'Use a different model for recaps')
  const summaries = models.summaries
  const recaps = utilityModelChoiceFor(models, 'recaps')
  const needsSetup = t('seal.summaryModels.needsSetup', 'Starts once its provider is set up.')
  const notice =
    access === 'outdated'
      ? host.label === null
        ? null
        : t(
            'seal.summaryModels.hostOutdated',
            'Update Seal on {{host}} to choose a provider there. Until then it runs summaries and recaps on Cloudflare Workers AI.',
            { host: host.label }
          )
      : access === 'unreachable'
        ? t(
            'seal.summaryModels.hostUnreachable',
            'Could not read the model providers on {{host}}.',
            { host: host.label ?? t('seal.summaryModels.thisComputer', 'this computer') }
          )
        : null

  const save = (task: 'summaries' | 'recaps', choice: UtilityModelChoice): void =>
    void model.setModels(
      task === 'summaries' ? { ...models, summaries: choice } : { ...models, recaps: choice }
    )

  return (
    <>
      {notice ? (
        <p role="status" className="text-xs text-muted-foreground">
          {notice}
        </p>
      ) : null}
      <SettingsGroup
        title={summariesTitle}
        description={t(
          'seal.summaryModels.summaries.groupDescription',
          'One short sentence on each agent session saying what it did or what it needs from you.'
        )}
      >
        <SearchableSetting
          title={summariesTitle}
          description={t(
            'seal.sessionSummaries.setting.searchDescription',
            'Show a one-line AI summary on agent sessions.'
          )}
          keywords={SESSION_SUMMARIES_SEARCH_KEYWORDS}
        >
          <SettingsSwitchRow
            label={summariesTitle}
            description={
              !loaded || status.configured
                ? t(
                    'seal.sessionSummaries.setting.description',
                    'When an agent stops or waits on a task, show one short sentence saying what it did or needs. Only the agent’s last message is sent, never tool output.'
                  )
                : needsSetup
            }
            checked={status?.enabled ?? true}
            disabled={!loaded || model.saving}
            onChange={() => void model.setSummariesEnabled(!(status?.enabled ?? true))}
          />
        </SearchableSetting>
        <UtilityModelChoiceRows
          task="summaries"
          choice={summaries}
          model={model}
          editable={editable}
          canTest={canTest}
          onChange={(choice) => save('summaries', choice)}
          onOpenAccounts={onOpenAccounts}
        />
      </SettingsGroup>

      <SettingsGroup
        title={recapTitle}
        description={t(
          'seal.summaryModels.recaps.groupDescription',
          'A longer account of each session: its goal, where it stands, and the questions and action items still on you.'
        )}
      >
        <SearchableSetting
          title={recapTitle}
          description={t(
            'seal.sessionRecap.setting.searchDescription',
            'Keep a recap of each agent session: goal, open questions, action items.'
          )}
          keywords={SESSION_SUMMARIES_SEARCH_KEYWORDS}
        >
          <SettingsSwitchRow
            label={recapTitle}
            description={
              !loaded || status.recapConfigured !== false
                ? t(
                    'seal.sessionRecap.setting.description',
                    'Keep a recap of each session: what it is for, where it stands, what you asked, and the questions and action items still on you. It also names sessions you have not named. Your messages, the agent’s replies, the paths of files it read or edited and the command lines it ran (credentials redacted) are sent. What tools print and the contents of files are never sent.'
                  )
                : needsSetup
            }
            checked={status?.recapEnabled ?? true}
            disabled={!loaded || model.saving}
            onChange={() => void model.setRecapEnabled(!(status?.recapEnabled ?? true))}
          />
        </SearchableSetting>
        <SearchableSetting
          title={separateTitle}
          description={t(
            'seal.summaryModels.separate.searchDescription',
            'Run session recaps on another provider or model than session summaries.'
          )}
          keywords={SESSION_SUMMARIES_SEARCH_KEYWORDS}
        >
          <SettingsSwitchRow
            label={separateTitle}
            description={
              models.recaps === null
                ? t(
                    'seal.summaryModels.separate.same',
                    'Recaps run on the same model as summaries: {{provider}} · {{model}}.',
                    {
                      provider: utilityModelProvider(summaries.provider).label,
                      model:
                        summaries.model ??
                        model.providers.find((entry) => entry.provider === summaries.provider)
                          ?.defaultModels[0] ??
                        utilityModelProvider(summaries.provider).defaultModel
                    }
                  )
                : t(
                    'seal.summaryModels.separate.different',
                    'A recap reads far more text than a summary, so a larger model can pay off here.'
                  )
            }
            checked={models.recaps !== null}
            disabled={!editable || model.saving}
            onChange={() =>
              void model.setModels({
                ...models,
                recaps: models.recaps === null ? { ...summaries } : null
              })
            }
          />
        </SearchableSetting>
        {models.recaps === null ? null : (
          <UtilityModelChoiceRows
            task="recaps"
            choice={recaps}
            model={model}
            editable={editable}
            canTest={canTest}
            onChange={(choice) => save('recaps', choice)}
            onOpenAccounts={onOpenAccounts}
          />
        )}
      </SettingsGroup>
    </>
  )
}

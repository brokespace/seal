import { useTranslate } from '@/i18n/use-translate'
import { useAppStore } from '@/store'
import type {
  SessionRecapUnavailableReason,
  SessionRecapView
} from '../../../../shared/session-recap/session-recap-types'
import {
  utilityModelChoiceFor,
  type UtilityModelChoice
} from '../../../../shared/utility-model/utility-model-selection'
import type { UtilityModelProviderId } from '../../../../shared/utility-model/utility-model-types'
import type { UsageCredentialHost } from '../settings/accounts/usage/usage-credential-host'
import { SessionRecapSwitchRow } from '../settings/session-summaries/SessionRecapSwitchRow'
import {
  useSessionSummarySettings,
  type SessionSummarySettingsModel
} from '../settings/session-summaries/use-session-summary-settings'
import { settingsAccountsSectionForUtilityProvider } from '../settings/session-summaries/utility-provider-accounts-section'
import { UtilityModelChoiceRows } from '../settings/session-summaries/UtilityModelChoiceRows'
import { recapStateNote } from './session-recap-copy'

/** A host from before it reported reasons says the same through its settings. */
function reasonFromSettings(
  model: SessionSummarySettingsModel
): SessionRecapUnavailableReason | undefined {
  const { status } = model
  if (status?.recapEnabled === false) {
    return { kind: 'recaps-off' }
  }
  return status?.recapConfigured === false
    ? {
        kind: 'provider-not-set-up',
        provider: utilityModelChoiceFor(model.models, 'recaps').provider
      }
    : undefined
}

/**
 * Why a host keeps no recap, and the setting that fixes it where there is one, applied on that
 * host. Remount (key by owner) to point it at another.
 */
export function SessionRecapSettingsFix({
  view,
  host,
  className,
  onChanged
}: {
  view: SessionRecapView
  host: UsageCredentialHost
  className: string
  /** A setting was saved on the host: the recap should be read again. */
  onChanged: () => void
}): React.JSX.Element {
  const t = useTranslate()
  const model = useSessionSummarySettings(host.owner)
  const openSettingsPage = useAppStore((state) => state.openSettingsPage)
  const openSettingsTarget = useAppStore((state) => state.openSettingsTarget)
  const reason = view.unavailableReason ?? reasonFromSettings(model)
  const { models } = model
  const choice = utilityModelChoiceFor(models, 'recaps')
  // Recaps get their own choice so fixing them never moves the summaries' provider.
  const save = (next: UtilityModelChoice): void =>
    void model.setModels({ ...models, recaps: next }).then(onChanged)
  const openAccounts = (provider: UtilityModelProviderId): void => {
    openSettingsPage()
    openSettingsTarget({
      pane: 'accounts',
      repoId: null,
      sectionId: settingsAccountsSectionForUtilityProvider(provider),
      hostScope: host.owner
    })
  }
  return (
    <div data-recap-note={view.state} className={className}>
      <p>{recapStateNote({ ...view, unavailableReason: reason }, t, host.label)}</p>
      {reason?.kind === 'recaps-off' ? (
        <SessionRecapSwitchRow model={model} compact onChanged={onChanged} />
      ) : null}
      {reason?.kind === 'provider-not-set-up' ? (
        <UtilityModelChoiceRows
          task="recaps"
          choice={choice}
          model={model}
          editable={model.access === 'ready'}
          canTest={false}
          compact
          onChange={save}
          onOpenAccounts={openAccounts}
        />
      ) : null}
    </div>
  )
}

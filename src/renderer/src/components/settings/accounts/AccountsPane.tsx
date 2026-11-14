import { useRef } from 'react'
import { useAppStore } from '../../../store/index'
import { useTranslate } from '@/i18n/use-translate'
import { isWebClientLocation } from '@/app-shell/platform/web-client-location'
import { getProviderAccountsOwnerKey } from '@/runtime/provider-accounts/observations/runtime-provider-accounts-client'
import {
  getAccountsGeminiSearchEntries,
  getAccountsCursorSearchEntries,
  getAccountsGrokSearchEntries,
  getAccountsAntigravitySearchEntries,
  getAccountsLocationSearchEntries,
  getAccountsMiniMaxSearchEntries,
  getAccountsOpencodeSearchEntries,
  getAccountsZcodePlanSearchEntries
} from './accounts-search'
import { getRemoteAccountsPaneScope } from '../../provider-accounts/provider-account-scope'
import { ProviderHostScopeControl } from '../../provider-accounts/ProviderHostScopeControl'
import { SettingsSectionStack } from '../section-layout/SettingsSectionStack'
import { matchesSettingsSearch } from '../search/settings-search'
import { GrokAccountsSection } from './providers/GrokAccountsSection'
import { AntigravityAccountsSection } from './providers/AntigravityAccountsSection'
import { runtimeTargetEnvironmentId } from '@/runtime/rpc/targets/runtime-client-target'
import { CursorAccountsSection } from './providers/CursorAccountsSection'
import { ZcodePlanAccountsSection } from './usage/ZcodePlanAccountsSection'
import type { AccountsPaneProps, AccountsPaneSectionModel } from './accounts-pane-types'
import { EMPTY_WSL_DISTROS, getSelectedAccountRuntime } from './scope/accounts-pane-runtime'
import { getRuntimeSentenceLabel } from '../../../lib/provider-accounts/account-runtime-label'
import { renderAccountsLocationSection } from './scope/accounts-pane-location-section'
import { renderGeminiAccountsSection } from './providers/accounts-pane-gemini-section'
import { renderOpenCodeAccountsSection } from './providers/accounts-pane-opencode-section'
import { MiniMaxAccountsSection } from './usage/MiniMaxAccountsSection'
import { useUsageHostSettings } from './usage/use-usage-host-settings'
import { ManagedDataAccountsSection } from './providers/ManagedDataAccountsSection'

export function AccountsPane({
  settings,
  updateSettings,
  updateSettingsOrThrow,
  hostScope,
  nativeAccounts = false,
  onAccountLocationChange,
  wslSupportedPlatform = false,
  wslAvailable = false,
  wslDistros = EMPTY_WSL_DISTROS,
  wslCapabilitiesLoading = false,
  accountOwnerPlatform = null,
  wslHostDistro = null
}: AccountsPaneProps): React.JSX.Element {
  const t = useTranslate()
  const searchQuery = useAppStore((s) => s.settingsSearchQuery)
  const miniMaxRateLimits = useAppStore((s) => s.rateLimits.minimax)
  const recordFeatureInteraction = useAppStore((s) => s.recordFeatureInteraction)
  const runtimeEnvironments = useAppStore((s) => s.runtimeEnvironments)
  const recordedOpenCodeSettingEditsRef = useRef<Set<'cookie' | 'workspaceId' | 'apiKey'>>(
    new Set()
  )
  const localAccountRuntime = getSelectedAccountRuntime(
    nativeAccounts ? { ...settings, localAccountRuntime: 'host' } : settings,
    wslSupportedPlatform,
    wslAvailable,
    wslDistros,
    wslCapabilitiesLoading,
    wslHostDistro,
    t
  )
  // Route all account actions to the Settings-selected owner, independent of focused host (#7973).
  const accountOwner = hostScope.target
  const isRemoteAccountScope = accountOwner.kind === 'environment'
  const scopeEnvironmentId = runtimeTargetEnvironmentId(hostScope.target)
  const accountOwnerKey = getProviderAccountsOwnerKey(accountOwner)
  // Keep real names separate so scope labels cannot interpolate prose fallbacks.
  const remoteServerName = isRemoteAccountScope
    ? (runtimeEnvironments.find((environment) => environment.id === scopeEnvironmentId)?.name ??
      null)
    : null
  const remoteServerLabel = isRemoteAccountScope
    ? (remoteServerName ??
      t('auto.components.settings.AccountsPane.remoteServerFallback', 'the remote server'))
    : null
  const accountRuntime = isRemoteAccountScope
    ? { runtime: 'host' as const, label: remoteServerLabel ?? '' }
    : localAccountRuntime
  const accountRuntimeSentenceLabel = isRemoteAccountScope
    ? accountRuntime.label
    : getRuntimeSentenceLabel(accountRuntime)
  const localAccountRuntimeSentenceLabel = getRuntimeSentenceLabel(localAccountRuntime)
  // Reassure desktop users that remote scope did not delete local accounts (#8186); web clients cannot switch back to local accounts.
  const remoteAccountScopeNotice =
    isRemoteAccountScope && !isWebClientLocation() ? (
      <ProviderHostScopeControl
        labelPrefix={t('auto.components.settings.AccountsPane.accountScopePrefix', 'Account scope')}
        scope={getRemoteAccountsPaneScope(remoteServerName, t)}
        className="text-xs"
      />
    ) : null

  const accountVisibilityOptions = {
    remoteOwner: isRemoteAccountScope,
    ownerPlatform: accountOwnerPlatform
  }
  const accountRuntimeUnavailable =
    accountRuntime.runtime === 'wsl' && !wslAvailable && !wslCapabilitiesLoading

  const recordOpenCodeSettingEdit = (field: 'cookie' | 'workspaceId' | 'apiKey'): void => {
    if (recordedOpenCodeSettingEditsRef.current.has(field)) {
      return
    }
    recordedOpenCodeSettingEditsRef.current.add(field)
    recordFeatureInteraction('usage-tracking')
  }
  // Usage credentials belong beside the selected host’s poller.
  const usageCredentialHost = { owner: accountOwner, label: remoteServerLabel }
  const usageHostSettings = useUsageHostSettings(
    accountOwner,
    remoteServerLabel,
    settings,
    updateSettings
  )

  const model: AccountsPaneSectionModel = {
    settings,
    accountOwner,
    updateSettings,
    updateSettingsOrThrow,
    onAccountLocationChange,
    searchQuery,
    recordFeatureInteraction,
    wslSupportedPlatform,
    wslAvailable,
    wslDistros,
    wslCapabilitiesLoading,
    localAccountRuntime,
    localAccountRuntimeSentenceLabel,
    isRemoteAccountScope,
    remoteServerName,
    remoteAccountScopeNotice,
    accountRuntime,
    accountRuntimeSentenceLabel,
    accountRuntimeUnavailable,
    accountVisibilityOptions,
    recordOpenCodeSettingEdit
  }
  const visibleSections = [
    !searchQuery || /opencode|devin|account/i.test(searchQuery) ? (
      <div key={accountOwnerKey} className="space-y-8">
        <ManagedDataAccountsSection provider="opencode" target={accountOwner} />
        <ManagedDataAccountsSection provider="devin" target={accountOwner} />
      </div>
    ) : null,
    wslSupportedPlatform &&
    !isRemoteAccountScope &&
    !wslHostDistro &&
    matchesSettingsSearch(searchQuery, getAccountsLocationSearchEntries())
      ? renderAccountsLocationSection(model, t)
      : null,
    matchesSettingsSearch(searchQuery, getAccountsGeminiSearchEntries())
      ? renderGeminiAccountsSection(model, t)
      : null,
    matchesSettingsSearch(searchQuery, getAccountsAntigravitySearchEntries()) ? (
      <AntigravityAccountsSection
        key={`antigravity:${accountOwnerKey}:${accountRuntime.runtime}:${accountRuntime.wslDistro ?? ''}`}
        owner={accountOwner}
        target={{ runtime: accountRuntime.runtime, wslDistro: accountRuntime.wslDistro }}
        label={accountRuntimeSentenceLabel}
        ownerPlatform={accountOwnerPlatform}
      />
    ) : null,
    matchesSettingsSearch(searchQuery, getAccountsOpencodeSearchEntries())
      ? renderOpenCodeAccountsSection(model, t)
      : null,
    matchesSettingsSearch(searchQuery, getAccountsMiniMaxSearchEntries()) ? (
      <MiniMaxAccountsSection
        key={`minimax:${accountOwnerKey}`}
        host={usageCredentialHost}
        usageSettings={usageHostSettings}
        miniMaxRateLimits={isRemoteAccountScope ? null : miniMaxRateLimits}
        recordFeatureInteraction={recordFeatureInteraction}
      />
    ) : null,
    matchesSettingsSearch(searchQuery, getAccountsGrokSearchEntries()) ? (
      <GrokAccountsSection key="grok" />
    ) : null,
    matchesSettingsSearch(searchQuery, getAccountsCursorSearchEntries()) ? (
      <CursorAccountsSection key="cursor" />
    ) : null,
    matchesSettingsSearch(searchQuery, getAccountsZcodePlanSearchEntries()) ? (
      <ZcodePlanAccountsSection
        key={`zcode:${accountOwnerKey}`}
        host={usageCredentialHost}
        usageSettings={usageHostSettings}
      />
    ) : null
  ]

  return (
    <div className="space-y-8">
      <SettingsSectionStack sections={visibleSections} />
    </div>
  )
}

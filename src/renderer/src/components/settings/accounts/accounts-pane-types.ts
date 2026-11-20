import type { ReactNode } from 'react'
import type { GlobalSettings } from '../../../../../shared/global-settings-types'
import type { FeatureInteractionId } from '../../../../../shared/feature-interaction-catalog'
import type { RuntimeClientTarget } from '../../../../../shared/runtime-client-target'
import type { SettingsHostScope } from '../host-scope/settings-host-scope'
import type { LocalAccountRuntime } from '../../../lib/provider-accounts/account-runtime-label'

export type AccountsPaneProps = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => Promise<void> | void
  updateSettingsOrThrow: (updates: Partial<GlobalSettings>) => Promise<void> | void
  hostScope: SettingsHostScope
  nativeAccounts?: boolean
  onAccountLocationChange?: () => void
  wslSupportedPlatform?: boolean
  wslAvailable?: boolean
  wslDistros?: string[]
  wslCapabilitiesLoading?: boolean
  accountOwnerPlatform?: NodeJS.Platform | null
  /** Set when the chosen host is a WSL host: this desktop owns that distro's accounts. */
  wslHostDistro?: string | null
}

export type ProviderAccountVisibilityOptions = {
  remoteOwner: boolean
  ownerPlatform: NodeJS.Platform | null
}

export type AccountsPaneSectionModel = {
  settings: GlobalSettings
  /** Host whose accounts the pane lists and mutates. */
  accountOwner: RuntimeClientTarget
  updateSettings: (updates: Partial<GlobalSettings>) => Promise<void> | void
  updateSettingsOrThrow: (updates: Partial<GlobalSettings>) => Promise<void> | void
  onAccountLocationChange?: () => void
  searchQuery: string
  recordFeatureInteraction: (featureId: FeatureInteractionId) => void
  wslSupportedPlatform: boolean
  wslAvailable: boolean
  wslDistros: string[]
  wslCapabilitiesLoading: boolean
  localAccountRuntime: LocalAccountRuntime
  localAccountRuntimeSentenceLabel: string
  isRemoteAccountScope: boolean
  remoteServerName: string | null
  remoteAccountScopeNotice: ReactNode
  accountRuntime: LocalAccountRuntime
  accountRuntimeSentenceLabel: string
  accountRuntimeUnavailable: boolean
  accountVisibilityOptions: ProviderAccountVisibilityOptions
  recordOpenCodeSettingEdit: (field: 'cookie' | 'workspaceId' | 'apiKey') => void
}

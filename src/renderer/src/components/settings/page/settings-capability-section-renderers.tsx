import { AccountsPane } from '../accounts/AccountsPane'
import { OtherProviderAccountsHeader } from '../accounts/OtherProviderAccountsHeader'
import { ClaudeAccountOptionRows } from '../accounts/claude/ClaudeAccountOptionRows'
import { getSealAccountsSearchEntries } from '../seal-accounts/seal-accounts-search'
import { matchesSettingsSearch } from '../search/settings-search'
import { SealAccountsPage } from '../seal-accounts/SealAccountsPage'
import type { RuntimeClientTarget } from '../../../../../shared/runtime-client-target'
import { getProviderAccountsOwnerKey } from '@/runtime/provider-accounts/observations/runtime-provider-accounts-client'
import { AgentConfigSettingsPane } from '../agent-config/AgentConfigSettingsPane'
import { AgentsPane } from '../agents/AgentsPane'
import { AgentDefaultSurfaceSection } from '../agents/surfaces/AgentDefaultSurfaceSection'
import { ComputerUsePane } from '../computer-use/ComputerUsePane'
import { LinearAgentSkillPane } from '../skills/linear/LinearAgentSkillPane'
import { OrchestrationPane } from '../orchestration/OrchestrationPane'
import { VoicePane } from '../voice/VoicePane'
import { SettingsSection } from '../section-layout/SettingsSection'
import {
  SettingsHostScopePicker,
  SettingsHostScopeUnavailableNotice,
  shouldShowSettingsHostScopePicker
} from '../host-scope/SettingsHostScopePicker'
import { LOCAL_SETTINGS_HOST_SCOPE } from '../host-scope/settings-host-scope'
import { wslHostDistroForTarget } from '@/runtime/provider-accounts/ownership/wsl-host-account-owner'
import { translate } from '@/i18n/i18n'
import type { Translate } from '@/i18n/use-translate'
import type { SettingsRenderContext } from './settings-render-context'

const LOCAL_RUNTIME_TARGET: RuntimeClientTarget = { kind: 'local' }

export function renderAgentsSettingsSection(
  context: SettingsRenderContext,
  t: Translate = translate
): React.JSX.Element {
  const { model, navigation, terminal, view } = context
  return (
    <SettingsSection
      id="agents"
      title={t('auto.components.settings.Settings.8afa676615', 'Agents')}
      description={t(
        'auto.components.settings.Settings.ec1ba547f7',
        'Manage AI agents, set a default, and customize commands.'
      )}
      searchEntries={navigation.getSectionSearchEntries('agents')}
    >
      {view.isSectionMounted('agents') ? (
        <div className="space-y-8">
          {model.settingsHostScope.target.kind === 'local' ? (
            <AgentDefaultSurfaceSection settings={model.settings} />
          ) : null}
          <AgentsPane
            settings={model.settings}
            updateSettings={model.updateSettings}
            hostScope={model.settingsHostScope}
            wslSupportedPlatform={terminal.localWslSupportedPlatform}
            wslAvailable={terminal.localWindowsRuntimeCapabilities.wslAvailable}
            wslDistros={terminal.localWindowsRuntimeCapabilities.wslDistros}
            wslCapabilitiesLoading={terminal.localWindowsRuntimeCapabilities.isLoading}
          />
        </div>
      ) : null}
    </SettingsSection>
  )
}

export function renderAgentConfigSettingsSection(
  context: SettingsRenderContext,
  t: Translate = translate
): React.JSX.Element | null {
  const { model, navigation, view } = context
  return model.showDesktopOnlySettings ? (
    <SettingsSection
      id="agent-config"
      title={t('auto.components.agentConfig.search.title', 'Agent configuration')}
      description={t(
        'auto.components.agentConfig.search.description',
        'Instructions, skills, MCP servers, plugins and settings for Claude Code, Codex and other agents.'
      )}
      searchEntries={navigation.getSectionSearchEntries('agent-config')}
    >
      {view.isSectionMounted('agent-config') ? <AgentConfigSettingsPane /> : null}
    </SettingsSection>
  ) : null
}

export function renderAccountsSettingsSection(
  context: SettingsRenderContext,
  t: Translate = translate
): React.JSX.Element {
  const { model, navigation, terminal, view } = context
  const wslHostDistro = wslHostDistroForTarget(
    model.settingsHostScope.target,
    model.runtimeEnvironments
  )
  // The desktop manages Seal accounts for its whole fleet; a web client manages its own server.
  const sealTarget = model.isWebClient ? model.settingsHostScope.target : LOCAL_RUNTIME_TARGET
  return (
    <SettingsSection
      id="accounts"
      title={t('seal.accounts.section.title', 'Accounts')}
      description={t(
        'seal.accounts.section.description',
        'The Claude, Codex and API-key accounts Seal runs agents on, how it swaps between them, and which machines hold each login.'
      )}
      searchEntries={navigation.getSectionSearchEntries('accounts')}
    >
      {!view.isSectionMounted('accounts') ? null : (
        <div className="space-y-10">
          {!matchesSettingsSearch(
            model.settingsSearchQuery,
            getSealAccountsSearchEntries()
          ) ? null : (
            <SealAccountsPage
              key={getProviderAccountsOwnerKey(sealTarget)}
              target={sealTarget}
              claudeOptions={
                <ClaudeAccountOptionRows
                  settings={model.settings}
                  updateSettings={model.updateSettings}
                />
              }
            />
          )}
          <OtherProviderAccountsHeader
            hostPicker={
              !model.isWebClient &&
              shouldShowSettingsHostScopePicker(
                model.settingsHostScope,
                model.runtimeEnvironments
              ) ? (
                <SettingsHostScopePicker
                  scope={model.settingsHostScope}
                  environments={model.runtimeEnvironments}
                  onChoose={model.setSettingsHostChoice}
                />
              ) : null
            }
          />
          {!model.settingsHostScope.available ? (
            <SettingsHostScopeUnavailableNotice />
          ) : (
            <AccountsPane
              key={wslHostDistro ?? getProviderAccountsOwnerKey(model.settingsHostScope.target)}
              nativeAccounts={model.nativeAccounts}
              onAccountLocationChange={model.releaseNativeAccounts}
              settings={model.settings}
              updateSettings={model.updateSettings}
              updateSettingsOrThrow={model.updateSettingsOrThrow}
              // A WSL host's orcad has no account services; this desktop owns its distro's accounts.
              hostScope={wslHostDistro ? LOCAL_SETTINGS_HOST_SCOPE : model.settingsHostScope}
              wslHostDistro={wslHostDistro}
              wslSupportedPlatform={
                wslHostDistro
                  ? terminal.localWslSupportedPlatform
                  : terminal.runtimeWslSupportedPlatform
              }
              wslAvailable={
                (wslHostDistro
                  ? terminal.localWindowsRuntimeCapabilities
                  : terminal.windowsTerminalCapabilities
                ).wslAvailable
              }
              wslDistros={
                (wslHostDistro
                  ? terminal.localWindowsRuntimeCapabilities
                  : terminal.windowsTerminalCapabilities
                ).wslDistros
              }
              wslCapabilitiesLoading={
                (wslHostDistro
                  ? terminal.localWindowsRuntimeCapabilities
                  : terminal.windowsTerminalCapabilities
                ).isLoading
              }
              accountOwnerPlatform={
                wslHostDistro ? undefined : terminal.windowsTerminalCapabilities.hostPlatform
              }
            />
          )}
        </div>
      )}
    </SettingsSection>
  )
}

export function renderOrchestrationSettingsSection(
  context: SettingsRenderContext,
  t: Translate = translate
): React.JSX.Element {
  const { model, navigation, view } = context
  return (
    <SettingsSection
      id="orchestration"
      title={t('auto.components.settings.Settings.00c3a7950d', 'Orchestration')}
      description={t(
        'auto.components.settings.Settings.475980f53d',
        'Coordinate multiple coding agents through Orca.'
      )}
      searchEntries={navigation.getSectionSearchEntries('orchestration')}
    >
      {view.isSectionMounted('orchestration') ? (
        <OrchestrationPane settings={model.settings} updateSettings={model.updateSettings} />
      ) : null}
    </SettingsSection>
  )
}

export function renderLinearSettingsSection(
  context: SettingsRenderContext,
  t: Translate = translate
): React.JSX.Element | null {
  const { model, navigation, view } = context
  return model.linearConnected ? (
    <SettingsSection
      id="linear"
      title={t('auto.components.settings.Settings.linearTitle', 'Linear')}
      description={t(
        'auto.components.settings.Settings.linearDescription',
        'How Linear works in Orca, setup checklist, agent skill, and example prompts.'
      )}
      searchEntries={navigation.getSectionSearchEntries('linear')}
    >
      {view.isSectionMounted('linear') ? <LinearAgentSkillPane /> : null}
    </SettingsSection>
  ) : null
}

export function renderDesktopCapabilitySettingsSections(
  context: SettingsRenderContext,
  t: Translate = translate
): React.JSX.Element | null {
  const { model, navigation, view } = context
  return model.showDesktopOnlySettings ? (
    <>
      <SettingsSection
        id="computer-use"
        title={t('auto.components.settings.Settings.3f3e11cb5d', 'Computer use')}
        description={t(
          'auto.components.settings.Settings.7118953f14',
          'Enable agents to control any app on your computer.'
        )}
        searchEntries={navigation.getSectionSearchEntries('computer-use')}
      >
        {view.isSectionMounted('computer-use') ? <ComputerUsePane /> : null}
      </SettingsSection>

      <SettingsSection
        id="voice"
        title={t('auto.components.settings.Settings.5063bb47a5', 'Voice')}
        description={t(
          'components.settings.voice.pageDescription',
          'Talk instead of typing in any pane.'
        )}
        searchEntries={navigation.getSectionSearchEntries('voice')}
      >
        {view.isSectionMounted('voice') ? (
          <VoicePane
            settings={model.settings}
            updateSettings={model.updateSettings}
            writeSourceControlAiSettings={context.interactions.writeSourceControlAiSettingsOrThrow}
          />
        ) : null}
      </SettingsSection>
    </>
  ) : null
}

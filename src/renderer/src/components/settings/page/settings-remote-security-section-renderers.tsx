import { DeveloperPermissionsPane } from '../developer-permissions/DeveloperPermissionsPane'
import { PrivacyPane } from '../privacy/PrivacyPane'
import { RuntimeEnvironmentsPane } from '../runtime-environments/catalog/RuntimeEnvironmentsPane'
import { RuntimeServersHeaderActions } from '../runtime-environments/runtime-servers-header-actions'
import { RuntimeServersPageProvider } from '../runtime-environments/runtime-servers-page-context'
import { SshPane } from '../ssh/SshPane'
import { SshHostsHeaderSlot, SshHostsHeaderSlotProvider } from '../ssh/ssh-hosts-header-slot'
import { SettingsSection } from '../section-layout/SettingsSection'
import { MachinesSettingsPane } from '../machines/MachinesSettingsPane'
import { translate } from '@/i18n/i18n'
import type { Translate } from '@/i18n/use-translate'
import type { SettingsRenderContext } from './settings-render-context'

export function renderServersSettingsSection(
  context: SettingsRenderContext,
  t: Translate = translate
): React.JSX.Element {
  const { model, navigation, view } = context
  const mounted = view.isSectionMounted('servers')
  return (
    <RuntimeServersPageProvider>
      <SettingsSection
        id="servers"
        title={t('auto.components.settings.Settings.022effa46f', 'Remote Seal servers')}
        description={
          model.isWebClient
            ? t(
                'auto.components.settings.Settings.7686cb5c36',
                'Connect this browser to a saved Seal server.'
              )
            : t(
                'auto.components.settings.Settings.remoteServersDescription',
                'Run Seal on another machine and work on it from here.'
              )
        }
        searchEntries={navigation.getSectionSearchEntries('servers')}
        headerAction={
          mounted ? (
            <RuntimeServersHeaderActions canGeneratePairingUrl={!model.isWebClient} />
          ) : undefined
        }
      >
        {mounted ? (
          <RuntimeEnvironmentsPane
            settings={model.settings}
            setActiveRuntimeEnvironmentPreference={model.setActiveRuntimeEnvironmentPreference}
            canGeneratePairingUrl={!model.isWebClient}
            allowLocalRuntime={!model.isWebClient}
            addServerIntentSignal={model.remoteServerAddIntentSignal}
          />
        ) : null}
      </SettingsSection>
    </RuntimeServersPageProvider>
  )
}

export function renderSshSettingsSection(
  context: SettingsRenderContext,
  t: Translate = translate
): React.JSX.Element | null {
  const { model, navigation, view } = context
  const mounted = view.isSectionMounted('ssh')
  return model.showDesktopOnlySettings ? (
    <SshHostsHeaderSlotProvider>
      <SettingsSection
        id="ssh"
        title={t('auto.components.settings.Settings.045db77e21', 'SSH hosts')}
        description={t(
          'auto.components.settings.Settings.c2ee313198',
          'Use existing machines over SSH for files, terminals, Git, and workspaces.'
        )}
        searchEntries={navigation.getSectionSearchEntries('ssh')}
        headerAction={mounted ? <SshHostsHeaderSlot /> : undefined}
      >
        {mounted ? <SshPane addTargetIntentSignal={model.sshHostAddIntentSignal} /> : null}
      </SettingsSection>
    </SshHostsHeaderSlotProvider>
  ) : null
}

/** Desktop: one section for every machine; the web client can only reach Seal servers. */
export function renderMachinesSettingsSection(
  context: SettingsRenderContext,
  t: Translate = translate
): React.JSX.Element {
  const { model, navigation, view } = context
  if (!model.showDesktopOnlySettings) {
    return renderServersSettingsSection(context, t)
  }
  const mounted = view.isSectionMounted('machines')
  return (
    <SettingsSection
      id="machines"
      title={t('auto.components.settings.Settings.machinesTitle', 'Machines')}
      description={t(
        'auto.components.settings.Settings.machinesDescription',
        'Other computers Seal works on: files, terminals, agents, Git and workspaces.'
      )}
      searchEntries={navigation.getSectionSearchEntries('machines')}
    >
      {mounted ? (
        <MachinesSettingsPane
          sshAddSignal={model.sshHostAddIntentSignal}
          serverAddSignal={model.remoteServerAddIntentSignal}
          advanced={
            <>
              <RuntimeServersPageProvider>
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-xs font-medium">
                      {t('auto.components.settings.Settings.machinesServers', 'Seal servers')}
                    </h3>
                    <RuntimeServersHeaderActions canGeneratePairingUrl />
                  </div>
                  <RuntimeEnvironmentsPane
                    settings={model.settings}
                    setActiveRuntimeEnvironmentPreference={
                      model.setActiveRuntimeEnvironmentPreference
                    }
                    canGeneratePairingUrl
                    allowLocalRuntime
                    addServerIntentSignal={0}
                  />
                </div>
              </RuntimeServersPageProvider>
              <SshHostsHeaderSlotProvider>
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-xs font-medium">
                      {t('auto.components.settings.Settings.machinesSsh', 'SSH connections')}
                    </h3>
                    <SshHostsHeaderSlot />
                  </div>
                  <SshPane addTargetIntentSignal={0} />
                </div>
              </SshHostsHeaderSlotProvider>
            </>
          }
        />
      ) : null}
    </SettingsSection>
  )
}

export function renderDeveloperPermissionsSettingsSection(
  context: SettingsRenderContext,
  t: Translate = translate
): React.JSX.Element | null {
  const { model, navigation, view } = context
  return model.showDesktopOnlySettings && model.isMac ? (
    <SettingsSection
      id="developer-permissions"
      title={t('auto.components.settings.Settings.65660d4548', 'macOS Permissions')}
      description={t(
        'auto.components.settings.Settings.9b83cc62c2',
        'macOS privacy access for terminal-launched developer tools.'
      )}
      searchEntries={navigation.getSectionSearchEntries('developer-permissions')}
    >
      {view.isSectionMounted('developer-permissions') ? <DeveloperPermissionsPane /> : null}
    </SettingsSection>
  ) : null
}

export function renderPrivacySettingsSection(
  context: SettingsRenderContext,
  t: Translate = translate
): React.JSX.Element {
  const { model, navigation, view } = context
  return (
    <SettingsSection
      id="privacy"
      title={t('auto.components.settings.Settings.742ca66ea6', 'Privacy & telemetry')}
      description={t(
        'auto.components.settings.Settings.c1b43dc4e2',
        'Anonymous usage data and telemetry controls.'
      )}
      searchEntries={navigation.getSectionSearchEntries('privacy')}
    >
      {view.isSectionMounted('privacy') ? <PrivacyPane settings={model.settings} /> : null}
    </SettingsSection>
  )
}

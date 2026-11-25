import { defineFixture } from '../../../component-fixtures/component-fixture'
import { getDefaultSettings } from '../../../../../shared/constants'
import type { ShellIntegrationStatus } from '../../../../../shared/shell-integration/shell-integration-installer'
import { LiveSessionsShellIntegrationSetting } from './LiveSessionsShellIntegrationSetting'
import { LiveSessionsIdleReapSetting } from './LiveSessionsIdleReapSetting'

function withStatus(status: ShellIntegrationStatus) {
  return () => {
    window.api.liveSessions = {
      ...window.api.liveSessions,
      shellIntegration: async () => status
    }
  }
}

const render = () => (
  <div className="px-4">
    <LiveSessionsShellIntegrationSetting
      settings={getDefaultSettings('/Users/brian')}
      updateSettings={() => {}}
    />
    <LiveSessionsIdleReapSetting
      settings={getDefaultSettings('/Users/brian')}
      updateSettings={() => {}}
    />
  </div>
)

export const installed = defineFixture({
  width: 720,
  setup: withStatus({
    installed: true,
    enabled: true,
    tmux: 'tmux 3.5a',
    rcFiles: ['/Users/brian/.zshrc', '/Users/brian/.bashrc']
  }),
  render
})

export const notInstalled = defineFixture({
  width: 720,
  setup: withStatus({ installed: false, enabled: false, tmux: 'tmux 3.5a', rcFiles: [] }),
  render
})

import type { GlobalSettings } from '../../../shared/global-settings-types'
import {
  parseShellIntegrationStatus,
  shellIntegrationScript,
  type ShellIntegrationAction,
  type ShellIntegrationStatus
} from '../../../shared/shell-integration/shell-integration-installer'
import type { LiveSessionHost } from '../hosts/live-session-hosts'

const TIMEOUT_MS = 60_000

export function wrapAgentsEnabled(
  settings: Pick<GlobalSettings, 'liveSessionsWrapAgents'>
): boolean {
  return settings.liveSessionsWrapAgents !== false
}

export async function runShellIntegration(
  host: LiveSessionHost,
  action: ShellIntegrationAction
): Promise<ShellIntegrationStatus> {
  const status = parseShellIntegrationStatus(
    await host.run(shellIntegrationScript(action), { timeoutMs: TIMEOUT_MS })
  )
  if (!status) {
    throw new Error(`Shell integration ${action} failed on ${host.machine.label}`)
  }
  return status
}

/**
 * Applies the on/off setting to every host Seal reaches, including SSH hosts that connect later.
 * Hosts without the integration installed are left alone.
 */
export class ShellIntegrationSync {
  private readonly applied = new Map<string, boolean>()

  constructor(
    private readonly enabled: () => boolean,
    private readonly log: (message: string, error?: unknown) => void
  ) {}

  settingChanged(): void {
    this.applied.clear()
  }

  reconcile(hosts: readonly LiveSessionHost[]): void {
    const enabled = this.enabled()
    for (const host of hosts) {
      if (this.applied.get(host.machine.hostId) === enabled) {
        continue
      }
      this.applied.set(host.machine.hostId, enabled)
      runShellIntegration(host, enabled ? 'enable' : 'disable').catch((error) => {
        this.applied.delete(host.machine.hostId)
        this.log(`Could not apply shell integration setting on ${host.machine.label}`, error)
      })
    }
  }
}

import { translate } from '@/i18n/i18n'
import type { Translate } from '@/i18n/use-translate'
import { getAgentCatalog } from '@/lib/agent-catalog/agent-catalog'
import type {
  ChatUnavailableReason,
  NewTabAgentMenuRow
} from '../../../../../shared/agent-launch/picker/agent-launch-picker-rows'

export function chatUnavailableLabel(
  reason: ChatUnavailableReason,
  t: Translate = translate
): string {
  switch (reason) {
    case 'check-failed':
      return t(
        'auto.components.tab.bar.QuickLaunchButton.chatCheckFailed',
        'Couldn’t check chat availability'
      )
    case 'not-installed':
      return t('auto.components.tab.bar.QuickLaunchButton.chatNotInstalled', 'Not installed')
    case 'needs-server':
      return installServerOfferLabel(t)
    case 'wsl':
      return t('auto.components.tab.bar.QuickLaunchButton.chatNotInWsl', 'No chat in WSL')
    case 'outside-workspace':
      return t('seal.launcher.chatOutsideWorkspace', 'No chat outside the workspace')
    case 'not-on-host':
      return t('auto.components.tab.bar.QuickLaunchButton.chatNotOnHost', 'No chat on this host')
    case 'windows':
      return t(
        'auto.components.tab.bar.QuickLaunchButton.chatNotOnWindows',
        'No chat on Windows yet'
      )
  }
}

/** The chat action of an SSH machine without the Seal server: it starts the install. */
export function installServerOfferLabel(t: Translate = translate): string {
  return t('seal.launcher.installServerToChat', 'Install Seal server to chat here')
}

/** The short name on an agent row's two launch actions. */
export function surfaceActionLabel(surface: 'chat' | 'terminal', t: Translate = translate): string {
  return surface === 'chat' ? t('seal.launcher.chat', 'Chat') : t('seal.launcher.cli', 'CLI')
}

/** Why a CLI action is disabled; `host` is omitted for this computer. */
export function cliMissingReason(
  label: string,
  host: string | null | undefined,
  t: Translate = translate
): string {
  return host
    ? t('seal.launcher.cliNotInstalledOn', '{{value0}} is not installed on {{value1}}', {
        value0: label,
        value1: host
      })
    : t('seal.launcher.cliNotInstalledHere', '{{value0}} is not installed on this computer', {
        value0: label
      })
}

/** Why a CLI action is disabled on an SSH machine without the Seal server: no terminal starts there. */
export function cliNeedsServerReason(t: Translate = translate): string {
  return t('seal.launcher.cliNeedsServer', 'Install Seal server to use the CLI here')
}

export function rowTitle(row: NewTabAgentMenuRow, label: string, t: Translate = translate): string {
  return row.kind === 'chat'
    ? t('auto.components.tab.bar.QuickLaunchButton.startChat', 'Start a chat with {{value0}}', {
        value0: label
      })
    : t(
        'auto.components.tab.bar.QuickLaunchButton.ec2adf093e',
        'Launch {{value0}} in a new terminal',
        { value0: label }
      )
}

export function rowLabel(row: NewTabAgentMenuRow, t: Translate = translate): string {
  const label = getAgentCatalog().find((entry) => entry.id === row.agent)?.label ?? row.agent
  return row.kind === 'cli'
    ? `${label} ${t('auto.components.tab.bar.QuickLaunchButton.cliTag', '(CLI)')}`
    : label
}

export function rowId(row: NewTabAgentMenuRow): string {
  return `${row.kind === 'chat-unavailable' ? 'chat' : row.kind}:${row.agent}`
}

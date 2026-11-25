import { useId } from 'react'
import { useTranslate } from '@/i18n/use-translate'
import { Switch } from '../../../ui/switch'
import { SettingsRow } from '../../form-controls/SettingsFormControls'

/** Colima, Lima and OrbStack add their VMs to ~/.ssh/config; they stay hidden unless asked for. */
export function SshAutoImportedHostsToggle({
  count,
  shown,
  onShownChange
}: {
  count: number
  shown: boolean
  onShownChange: (shown: boolean) => void
}): React.JSX.Element | null {
  const t = useTranslate()
  const labelId = useId()
  if (count === 0) {
    return null
  }
  return (
    <SettingsRow
      className="px-1"
      labelId={labelId}
      label={t('auto.components.settings.ssh.autoImported.label', 'Show auto-imported hosts')}
      description={t(
        'auto.components.settings.ssh.autoImported.description',
        '{{count}} host(s) that Colima, Lima or OrbStack added to ~/.ssh/config for their own VMs.',
        { count }
      )}
      control={<Switch aria-labelledby={labelId} checked={shown} onCheckedChange={onShownChange} />}
    />
  )
}

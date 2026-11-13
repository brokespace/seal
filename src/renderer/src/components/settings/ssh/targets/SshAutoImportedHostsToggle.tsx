import { useId } from 'react'
import { useTranslate } from '@/i18n/use-translate'
import { Label } from '../../../ui/label'
import { Switch } from '../../../ui/switch'

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
  const id = useId()
  if (count === 0) {
    return null
  }
  return (
    <div className="flex items-center justify-between gap-3 px-1 py-2">
      <Label htmlFor={id} className="flex flex-col items-start gap-0.5 font-normal">
        <span className="text-xs text-foreground">
          {t('auto.components.settings.ssh.autoImported.label', 'Show auto-imported hosts')}
        </span>
        <span className="text-xs text-muted-foreground">
          {t(
            'auto.components.settings.ssh.autoImported.description',
            '{{count}} host(s) that Colima, Lima or OrbStack added to ~/.ssh/config for their own VMs.',
            { count }
          )}
        </span>
      </Label>
      <Switch id={id} checked={shown} onCheckedChange={onShownChange} />
    </div>
  )
}

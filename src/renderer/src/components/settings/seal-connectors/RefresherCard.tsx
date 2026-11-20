import { useState } from 'react'
import { LoaderCircle, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { useTranslate } from '@/i18n/use-translate'
import { formatUiNarrowRelativeTime } from '@/i18n/relative-time-format'
import { SettingsBadge, SettingsRow } from '../form-controls/SettingsFormControls'
import { SettingsGroup } from '../section-layout/SettingsGroup'
import { currentRefresherLease, hostByKey } from './seal-connector-status'
import { connectorsCall, connectorsHostTarget, type SealConnectors } from './use-seal-connectors'

const AUTOMATIC = '__automatic__'

type RefreshNowResult = { refreshed: string[]; skipped: string | null }

function ageText(heartbeatAt: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - heartbeatAt) / 1000))
  return seconds < 90
    ? formatUiNarrowRelativeTime(-seconds, 'second')
    : formatUiNarrowRelativeTime(-Math.round(seconds / 60), 'minute')
}

/** Which machine renews every sign-in before it expires, with a way to move it or renew now. */
export function RefresherCard({
  connectors,
  now: nowOverride
}: {
  connectors: SealConnectors
  now?: number
}): React.JSX.Element {
  const now = nowOverride ?? connectors.readAt
  const t = useTranslate()
  const { fleet, config, setRefresher, refresh } = connectors
  const [refreshing, setRefreshing] = useState(false)
  const lease = currentRefresherLease(fleet)
  const owner = hostByKey(fleet, lease?.ownerHostKey ?? null)
  const designated = config?.refresher.designatedHostKey ?? null
  const choices = (fleet?.hosts ?? []).filter(
    (host) => host.status?.hostKey && (host.online || host.status.hostKey === designated)
  )

  const refreshNow = async (): Promise<void> => {
    if (!owner) {
      return
    }
    setRefreshing(true)
    try {
      const result = await connectorsCall<RefreshNowResult>(
        'seal.connectors.refreshNow',
        {},
        { target: connectorsHostTarget(owner), timeoutMs: 120_000 }
      )
      if (result.refreshed.length > 0) {
        toast.success(
          t('seal.connectors.refresher.refreshed', 'Refreshed {{count}} sign-ins.', {
            count: result.refreshed.length
          })
        )
      } else {
        toast(
          t('seal.connectors.refresher.nothing', 'Nothing was refreshed.'),
          result.skipped ? { description: result.skipped } : undefined
        )
      }
      await refresh()
    } catch (caught) {
      toast.error(t('seal.connectors.refresher.failed', 'Could not refresh sign-ins'), {
        description: caught instanceof Error ? caught.message : String(caught)
      })
    }
    setRefreshing(false)
  }

  return (
    <SettingsGroup
      title={t('seal.connectors.refresher.title', 'Refresher')}
      description={t(
        'seal.connectors.refresher.description',
        'One machine renews sign-ins before they expire and passes the new ones to every other machine. If it goes quiet, another takes over.'
      )}
    >
      <SettingsRow
        label={
          <span className="flex items-center gap-2" data-connector-refresher="">
            {owner
              ? owner.label
              : t('seal.connectors.refresher.noOwner', 'No machine is refreshing yet')}
            {owner ? (
              <SettingsBadge tone={owner.online ? 'accent' : 'muted'}>
                {owner.online
                  ? t('seal.connectors.refresher.online', 'Online')
                  : t('seal.connectors.refresher.offline', 'Offline')}
              </SettingsBadge>
            ) : null}
          </span>
        }
        description={
          lease && owner
            ? t('seal.connectors.refresher.heartbeat', 'Last heartbeat {{age}}.', {
                age: ageText(lease.heartbeatAt, now)
              })
            : t(
                'seal.connectors.refresher.pending',
                'Seal picks one as soon as a machine reports in.'
              )
        }
        control={
          <div className="flex items-center gap-2">
            <Select
              value={designated ?? AUTOMATIC}
              onValueChange={(value) => void setRefresher(value === AUTOMATIC ? null : value)}
            >
              <SelectTrigger
                size="sm"
                className="w-48"
                aria-label={t('seal.connectors.refresher.change', 'Change refresher')}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={AUTOMATIC}>
                  {t('seal.connectors.refresher.automatic', 'Automatic')}
                </SelectItem>
                {choices.map((host) => (
                  <SelectItem key={host.target} value={host.status?.hostKey ?? host.target}>
                    {host.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              disabled={!owner?.online || refreshing}
              onClick={() => void refreshNow()}
            >
              {refreshing ? (
                <LoaderCircle className="animate-spin motion-reduce:animate-none" />
              ) : (
                <RefreshCw />
              )}
              {t('seal.connectors.refresher.refreshNow', 'Refresh now')}
            </Button>
          </div>
        }
      />
    </SettingsGroup>
  )
}

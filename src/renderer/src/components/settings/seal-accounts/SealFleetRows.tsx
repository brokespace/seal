import { useState } from 'react'
import { useTranslate } from '@/i18n/use-translate'
import { Button } from '../../ui/button'
import { SettingsRow } from '../form-controls/SettingsFormControls'
import { HostListOverflowNote } from '../../host-picker/HostListOverflowNote'
import { HostListSearchField } from '../../host-picker/HostListSearchField'
import { useBoundedHostRows } from '../../host-picker/use-bounded-host-rows'

export type SealFleetHost = { id: string; label: string }

type SealFleetRowsProps = {
  hosts: SealFleetHost[]
  loginCount: number
  onSync: (environmentId: string, includeLogins: boolean) => Promise<string | null>
}

/** Remote hosts this desktop manages; rules always sync, logins only when asked. */
export function SealFleetRows({ hosts, loginCount, onSync }: SealFleetRowsProps) {
  const t = useTranslate()
  const [busy, setBusy] = useState<string | null>(null)
  const [results, setResults] = useState<Record<string, string>>({})
  const { shown, hiddenCount, query, setQuery, searchable } = useBoundedHostRows(hosts)

  if (hosts.length === 0) {
    return (
      <p className="py-3 text-xs text-muted-foreground" data-settings-row="">
        {t(
          'seal.accounts.fleet.empty',
          'Add an SSH host or remote server to share accounts and rules with it.'
        )}
      </p>
    )
  }

  const run = async (host: SealFleetHost, includeLogins: boolean): Promise<void> => {
    setBusy(host.id)
    const summary = await onSync(host.id, includeLogins)
    setBusy(null)
    if (summary) {
      setResults((current) => ({ ...current, [host.id]: summary }))
    }
  }

  return (
    <>
      {searchable ? <HostListSearchField value={query} onChange={setQuery} /> : null}
      {shown.map((host) => (
        <SettingsRow
          key={host.id}
          label={host.label}
          description={
            results[host.id] ??
            t(
              'seal.accounts.fleet.hostDescription',
              'Runs agents with its own copy of your logins.'
            )
          }
          control={
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="xs"
                disabled={busy !== null}
                onClick={() => void run(host, false)}
              >
                {t('seal.accounts.fleet.pushRules', 'Push rules')}
              </Button>
              <Button
                variant="outline"
                size="xs"
                disabled={busy !== null || loginCount === 0}
                onClick={() => void run(host, true)}
              >
                {t('seal.accounts.fleet.pushLogins', 'Copy logins ({{value0}})', {
                  value0: loginCount
                })}
              </Button>
            </div>
          }
        />
      ))}
      <HostListOverflowNote hiddenCount={hiddenCount} />
    </>
  )
}

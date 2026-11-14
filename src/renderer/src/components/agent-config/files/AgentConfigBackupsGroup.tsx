import React, { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { uiDateTimeFormat } from '@/i18n/ui-intl-formatters'
import { useTranslate } from '@/i18n/use-translate'
import type { AgentConfigBackup } from '../../../../../shared/agent-config/agent-config-types'
import { SettingsGroup } from '../../settings/section-layout/SettingsGroup'
import {
  AgentConfigConfirmDialog,
  type AgentConfigConfirmRequest
} from '../AgentConfigConfirmDialog'
import { agentConfigApi, agentConfigErrorText } from '../model/agent-config-client'
import { useAgentConfig } from '../model/agent-config-context'

const SHOWN = 30
const TAKEN_AT: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'medium' }

function takenAt(backup: AgentConfigBackup): string {
  return uiDateTimeFormat(TAKEN_AT).format(new Date(backup.takenAt))
}

/** Every change Seal made on this machine left the previous file here. */
export function AgentConfigBackupsGroup(): React.JSX.Element {
  const t = useTranslate()
  const { machine, snapshot, reload } = useAgentConfig()
  const [backups, setBackups] = useState<AgentConfigBackup[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [confirm, setConfirm] = useState<AgentConfigConfirmRequest | null>(null)

  // The snapshot is replaced after every change, which is exactly when a new backup exists.
  useEffect(() => {
    let cancelled = false
    void Promise.resolve()
      .then(() => agentConfigApi().listBackups({ machineId: machine.id }))
      .then(
        (list) => {
          if (!cancelled) {
            setBackups(list)
            setError(null)
          }
        },
        (failure) => {
          if (!cancelled) {
            setError(agentConfigErrorText(failure))
          }
        }
      )
    return () => {
      cancelled = true
    }
  }, [machine.id, snapshot])

  const shown = showAll ? (backups ?? []) : (backups ?? []).slice(0, SHOWN)
  const home = snapshot.homeDir
  const short = (path: string): string =>
    path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path

  return (
    <>
      <SettingsGroup
        title={t('auto.components.agentConfig.backups.title', 'Backups')}
        description={t(
          'auto.components.agentConfig.backups.description',
          'Before Seal changes or deletes a file on {{machine}}, it keeps the previous one in ~/.seal/config-backups.',
          { machine: machine.label }
        )}
      >
        {error ? (
          <p data-settings-row="" className="py-3 text-xs text-destructive" role="alert">
            {error}
          </p>
        ) : backups === null ? (
          <div data-settings-row="" className="flex justify-center py-3">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          </div>
        ) : backups.length === 0 ? (
          <p data-settings-row="" className="py-3 text-xs text-muted-foreground">
            {t(
              'auto.components.agentConfig.backups.none',
              'Nothing has been changed from Seal yet.'
            )}
          </p>
        ) : (
          shown.map((backup) => (
            <div
              key={backup.backupPath}
              data-settings-row=""
              className="flex items-center gap-2 py-2"
              data-agent-config-backup={backup.originalPath}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-xs" title={backup.originalPath}>
                  {short(backup.originalPath)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {takenAt(backup)}
                  {backup.isDirectory
                    ? ` · ${t('auto.components.agentConfig.backups.folder', 'folder')}`
                    : ''}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  setConfirm({
                    title: t(
                      'auto.components.agentConfig.backups.restoreTitle',
                      'Restore this backup?'
                    ),
                    description: t(
                      'auto.components.agentConfig.backups.restoreDescription',
                      '{{path}} goes back to how it was on {{when}}. What is there now is backed up first.',
                      {
                        path: short(backup.originalPath),
                        when: takenAt(backup)
                      }
                    ),
                    confirmLabel: t('auto.components.agentConfig.backups.restore', 'Restore'),
                    run: async () => {
                      await agentConfigApi().restoreBackup({
                        machineId: machine.id,
                        backupPath: backup.backupPath
                      })
                      reload()
                    }
                  })
                }
              >
                {t('auto.components.agentConfig.backups.restore', 'Restore')}
              </Button>
            </div>
          ))
        )}
        {backups && backups.length > SHOWN && !showAll ? (
          <div data-settings-row="" className="py-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setShowAll(true)}>
              {t('auto.components.agentConfig.backups.showAll', 'Show all {{count}}', {
                count: backups.length
              })}
            </Button>
          </div>
        ) : null}
      </SettingsGroup>
      <AgentConfigConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
    </>
  )
}

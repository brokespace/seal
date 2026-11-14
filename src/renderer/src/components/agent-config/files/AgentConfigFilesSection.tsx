import React, { useMemo, useState } from 'react'
import { useTranslate } from '@/i18n/use-translate'
import { validationKindForPath } from '../../../../../shared/agent-config/agent-config-validation'
import { MachineFileExplorer } from '../../machines/explorer/MachineFileExplorer'
import type { MachineExplorerFileOps } from '../../machines/explorer/machine-explorer-source'
import { SettingsBadge } from '../../settings/form-controls/SettingsFormControls'
import { SettingsGroup } from '../../settings/section-layout/SettingsGroup'
import { AgentConfigScopeBadge } from '../AgentConfigScopeBadge'
import {
  AgentConfigDocumentSheet,
  type AgentConfigOpenDocument
} from '../documents/AgentConfigDocumentSheet'
import { agentConfigApi } from '../model/agent-config-client'
import { useAgentConfig } from '../model/agent-config-context'
import { AgentConfigBackupsGroup } from './AgentConfigBackupsGroup'

/** The raw fallback: every file by path, the agent's folder as a tree, and what was backed up. */
export function AgentConfigFilesSection(): React.JSX.Element {
  const t = useTranslate()
  const { snapshot, machine, target, layout, reload } = useAgentConfig()
  const [open, setOpen] = useState<AgentConfigOpenDocument | null>(null)

  // Edits made from the tree get the same checks and backups as the forms.
  const fileOps = useMemo<MachineExplorerFileOps>(
    () => ({
      readText: async (path) => (await agentConfigApi().readDocument({ target, path })).content,
      write: async (path, content) => {
        await agentConfigApi().saveDocument({ target, path, content })
        reload()
      },
      rename: async (from, to) => {
        await agentConfigApi().renamePath({ target, from, to })
        reload()
      },
      remove: async (paths) => {
        await agentConfigApi().removePaths({ target, paths: [...paths] })
        reload()
      },
      removeDescription: t(
        'auto.components.agentConfig.files.removeDescription',
        'They are moved to ~/.seal/config-backups on the machine and can be restored from there.'
      )
    }),
    [reload, t, target]
  )

  return (
    <div className="space-y-6" data-agent-config-section="files">
      <SettingsGroup
        title={t('auto.components.agentConfig.files.known', 'Configuration files')}
        description={t(
          'auto.components.agentConfig.files.knownDescription',
          'Every file {{agent}} reads here. Opening one edits it as text, with the same checks and backups.',
          { agent: layout.label }
        )}
      >
        {snapshot.files.map((file) => (
          <button
            key={file.path}
            type="button"
            data-settings-row=""
            data-agent-config-file={file.id}
            className="flex w-full items-center gap-2 py-2 text-left outline-none hover:bg-muted/40 focus-visible:ring-1 focus-visible:ring-ring"
            onClick={() =>
              setOpen({
                path: file.path,
                title: file.label,
                validation: validationKindForPath(file.path),
                scope: file.scope
              })
            }
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">{file.label}</p>
              <p className="truncate font-mono text-xs text-muted-foreground" title={file.path}>
                {file.path}
              </p>
              {file.error ? (
                <p className="text-xs text-destructive [overflow-wrap:anywhere]">{file.error}</p>
              ) : null}
            </div>
            {file.exists ? null : (
              <SettingsBadge tone="muted">
                {t('auto.components.agentConfig.files.missing', 'Not created')}
              </SettingsBadge>
            )}
            <AgentConfigScopeBadge scope={file.scope} />
          </button>
        ))}
      </SettingsGroup>

      <div className="space-y-2">
        <div>
          <h4 className="text-sm font-medium">
            {t('auto.components.agentConfig.files.browse', 'Browse the folder')}
          </h4>
          <p className="text-xs text-muted-foreground">
            {t(
              'auto.components.agentConfig.files.browseDescription',
              'Everything under {{path}}, including files Seal has no form for.',
              { path: snapshot.agentDir }
            )}
          </p>
        </div>
        <div
          className="flex h-[420px] overflow-hidden rounded-md border border-border"
          data-agent-config-explorer=""
        >
          <MachineFileExplorer
            key={`${machine.id}\n${snapshot.agentDir}`}
            machine={machine}
            startAt={snapshot.agentDir}
            fileOps={fileOps}
          />
        </div>
      </div>

      <AgentConfigBackupsGroup />
      <AgentConfigDocumentSheet document={open} onClose={() => setOpen(null)} />
    </div>
  )
}

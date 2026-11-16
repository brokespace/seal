import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { VirtualizedList } from '@/components/virtualized-list'
import { useTranslate } from '@/i18n/use-translate'
import { MACHINE_DOCKER_VOLUME_PREVIEW_MAX_BYTES } from '../../../../../shared/machines/machine-docker-types'
import type { MachineSummary } from '../../../../../shared/machines/machine-summaries'
import type { MachineFileEntry } from '../../../../../shared/machines/machine-types'
import {
  MACHINE_EXPLORER_ROW_HEIGHT,
  MachineExplorerRow,
  machineExplorerRowPadding,
  type MachineExplorerRowHandlers
} from '../explorer/MachineExplorerRow'
import { MachineFilePreview } from '../explorer/MachineFilePreview'
import type {
  MachineExplorerSource,
  MachineFilePreviewSource
} from '../explorer/machine-explorer-source'
import { useExplorerTree } from '../explorer/use-machine-explorer-tree'
import { machineResourceApi } from './machine-resource-requests'

const VOLUME_ROOT = '/'

/** A volume's files as a tree with the picked file under it; nothing here can change them. */
export function MachineDockerVolumeFiles({
  machine,
  volume,
  revision
}: {
  machine: MachineSummary
  volume: string
  /** Changes when the sheet is refreshed, to list the folders again. */
  revision: number
}): React.JSX.Element {
  const t = useTranslate()
  const machineId = machine.id
  const sources = useMemo((): { tree: MachineExplorerSource; file: MachineFilePreviewSource } => {
    const key = `docker-volume:${volume}`
    return {
      tree: {
        key: `${machineId}\n${key}`,
        startAt: VOLUME_ROOT,
        list: (path) =>
          machineResourceApi().dockerVolumeListDir({
            machineId,
            volume,
            path: path ?? VOLUME_ROOT
          })
      },
      file: {
        key,
        read: (path) => machineResourceApi().dockerVolumeReadFile({ machineId, volume, path }),
        maxBytes: MACHINE_DOCKER_VOLUME_PREVIEW_MAX_BYTES
      }
    }
  }, [machineId, volume])
  const tree = useExplorerTree(sources.tree, machine.status === 'online', true)
  const { toggle, refresh } = tree
  const [selected, setSelected] = useState<{ path: string; entry: MachineFileEntry } | null>(null)
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null)

  const refreshed = useRef(revision)
  useEffect(() => {
    if (refreshed.current !== revision) {
      refreshed.current = revision
      refresh()
    }
  }, [revision, refresh])

  const handlers = useMemo<MachineExplorerRowHandlers>(
    () => ({
      onClick: (row) => {
        if (row.entry.isDirectoryLike) {
          toggle(row.path)
        } else {
          setSelected({ path: row.path, entry: row.entry })
        }
      },
      onRetry: (path) => refresh(path),
      onLoadMore: () => {}
    }),
    [toggle, refresh]
  )

  const root = tree.folders.get(VOLUME_ROOT)
  return (
    <div className="space-y-2" data-machine-docker-volume-files={volume}>
      {root?.error && root.entries.length === 0 ? (
        <div className="flex flex-wrap items-start gap-x-3 gap-y-1.5">
          <p
            className="min-w-0 flex-1 text-xs text-destructive [overflow-wrap:anywhere]"
            role="alert"
          >
            {root.error}
          </p>
          <Button type="button" variant="outline" size="xs" onClick={() => refresh(VOLUME_ROOT)}>
            {t('auto.components.machines.explorer.retry', 'Retry')}
          </Button>
        </div>
      ) : !root || (root.loading && root.entries.length === 0) ? (
        <div className="flex h-24 items-center justify-center rounded-md border border-border">
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        </div>
      ) : tree.rows.length === 0 ? (
        <p className="rounded-md border border-border px-3 py-2.5 text-xs text-muted-foreground">
          {t('auto.components.machines.dockerDetails.volumeEmpty', 'This volume is empty.')}
        </p>
      ) : (
        <div
          ref={setScrollElement}
          role="tree"
          aria-label={t('auto.components.machines.dockerDetails.filesOf', 'Files in {{volume}}', {
            volume
          })}
          className="scrollbar-sleek @container/tree max-h-72 overflow-auto rounded-md border border-border py-1"
        >
          <VirtualizedList
            rows={tree.rows}
            getRowKey={(row) => row.key}
            scrollElement={scrollElement}
            estimateRowHeightPx={MACHINE_EXPLORER_ROW_HEIGHT}
            renderRow={(row) => {
              // A volume's folder is read in one go, so what was left out cannot be asked for.
              const folder = row.type === 'more' ? tree.folders.get(row.path) : undefined
              return (
                <div key={row.key} style={{ height: MACHINE_EXPLORER_ROW_HEIGHT }}>
                  {folder ? (
                    <div
                      className="flex h-full items-center text-xs text-muted-foreground"
                      style={machineExplorerRowPadding(row.depth)}
                    >
                      {t(
                        'auto.components.machines.dockerDetails.showingOf',
                        'Showing {{shown}} of {{total}}',
                        { shown: folder.entries.length, total: folder.totalEntries }
                      )}
                    </div>
                  ) : (
                    <MachineExplorerRow
                      row={row}
                      selected={row.type === 'entry' && row.path === selected?.path}
                      dropTarget={false}
                      handlers={handlers}
                    />
                  )}
                </div>
              )
            }}
          />
        </div>
      )}
      {selected ? (
        <div
          className="flex h-80 min-h-0 overflow-hidden rounded-md border border-border"
          data-machine-docker-volume-file={selected.path}
        >
          <MachineFilePreview
            key={selected.path}
            machineId={machineId}
            path={selected.path}
            entry={selected.entry}
            source={sources.file}
            readOnly
            onClose={() => setSelected(null)}
          />
        </div>
      ) : null}
    </div>
  )
}

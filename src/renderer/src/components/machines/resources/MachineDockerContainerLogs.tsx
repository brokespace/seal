import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Copy, Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SwitchIndicator } from '@/components/ui/switch'
import { useTranslate } from '@/i18n/use-translate'
import { installWindowVisibilityInterval } from '@/lib/window-activity/window-visibility-interval'
import type { MachineDockerLogs } from '../../../../../shared/machines/machine-docker-types'
import type { MachineId } from '../../../../../shared/machines/machine-types'
import { MachineDiskRowAction } from './MachineDiskRowAction'
import { copyDockerText } from './MachineDockerDetailFacts'
import { machineResourceApi, resourceErrorText } from './machine-resource-requests'

const FOLLOW_MS = 3_000
/** Within this of the end counts as reading the newest lines. */
const PINNED_SLACK_PX = 16

function lineCount(text: string): number {
  return text === '' ? 0 : text.replace(/\n$/, '').split('\n').length
}

/** The tail of a container's log, re-read while it runs for as long as following is on. */
export function MachineDockerContainerLogs({
  machineId,
  containerId,
  running,
  revision
}: {
  machineId: MachineId
  containerId: string
  running: boolean
  /** Changes when the sheet is refreshed or the container was acted on, to read again. */
  revision: number
}): React.JSX.Element {
  const t = useTranslate()
  const [logs, setLogs] = useState<MachineDockerLogs | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [follow, setFollow] = useState(true)
  const [reads, setReads] = useState(0)
  const boxRef = useRef<HTMLPreElement>(null)
  const pinnedRef = useRef(true)
  const following = follow && running

  useEffect(() => {
    let cancelled = false
    let reading = false
    const read = async (): Promise<void> => {
      if (reading) {
        return
      }
      reading = true
      try {
        const next = await machineResourceApi().dockerContainerLogs({ machineId, containerId })
        if (!cancelled) {
          setLogs(next)
          setError(null)
        }
      } catch (err) {
        if (!cancelled) {
          setError(resourceErrorText(err))
        }
      }
      reading = false
    }
    const stop = following
      ? installWindowVisibilityInterval({ run: () => void read(), intervalMs: FOLLOW_MS })
      : void read()
    return () => {
      cancelled = true
      stop?.()
    }
  }, [machineId, containerId, following, revision, reads])

  useLayoutEffect(() => {
    const box = boxRef.current
    if (box && pinnedRef.current) {
      box.scrollTop = box.scrollHeight
    }
  }, [logs])

  const lines = logs ? lineCount(logs.text) : 0
  return (
    <div className="space-y-1.5" data-machine-docker-logs={following ? 'following' : 'idle'}>
      <div className="flex min-h-6 flex-wrap items-center gap-x-2 gap-y-1">
        <p className="min-w-0 flex-1 text-2xs text-muted-foreground">
          {logs === null
            ? null
            : logs.truncated
              ? t(
                  'auto.components.machines.dockerDetails.logs.tail',
                  'Showing the last {{count}} lines. Older lines were not fetched.',
                  {
                    count: lines,
                    defaultValue_one: 'Showing the last line. Older lines were not fetched.'
                  }
                )
              : t('auto.components.machines.dockerDetails.logs.lines', '{{count}} lines', {
                  count: lines,
                  defaultValue_one: '{{count}} line'
                })}
        </p>
        {running ? (
          <Button
            type="button"
            role="switch"
            variant="ghost"
            size="xs"
            aria-checked={follow}
            onClick={() => setFollow((value) => !value)}
          >
            <SwitchIndicator checked={follow} size="compact" />
            {t('auto.components.machines.dockerDetails.logs.follow', 'Follow')}
          </Button>
        ) : null}
        <MachineDiskRowAction
          label={t('auto.components.machines.dockerDetails.logs.refresh', 'Refresh logs')}
          onClick={() => setReads((count) => count + 1)}
        >
          <RefreshCw />
        </MachineDiskRowAction>
        <MachineDiskRowAction
          label={t('auto.components.machines.dockerDetails.logs.copy', 'Copy logs')}
          onClick={() =>
            void copyDockerText(
              logs?.text ?? '',
              t('auto.components.machines.dockerDetails.logs.copied', 'Copied the logs'),
              t('auto.components.machines.dockerDetails.copyFailed', 'Could not copy')
            )
          }
        >
          <Copy />
        </MachineDiskRowAction>
      </div>
      {error ? (
        <p className="text-xs text-destructive [overflow-wrap:anywhere]" role="alert">
          {error}
        </p>
      ) : null}
      {logs === null ? (
        error ? null : (
          <div className="flex h-24 items-center justify-center rounded-md border border-border">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          </div>
        )
      ) : lines === 0 ? (
        <p className="rounded-md border border-border px-3 py-2.5 text-xs text-muted-foreground">
          {t(
            'auto.components.machines.dockerDetails.logs.empty',
            'This container has not written any logs.'
          )}
        </p>
      ) : (
        <pre
          ref={boxRef}
          tabIndex={0}
          className="scrollbar-sleek max-h-96 overflow-auto rounded-md border border-border bg-editor-surface px-3 py-2 font-mono text-2xs leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere] select-text"
          onScroll={(event) => {
            const box = event.currentTarget
            pinnedRef.current =
              box.scrollHeight - box.scrollTop - box.clientHeight < PINNED_SLACK_PX
          }}
        >
          {logs.text}
        </pre>
      )}
    </div>
  )
}

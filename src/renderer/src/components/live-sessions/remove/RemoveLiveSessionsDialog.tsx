import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '../../ui/button'
import { Checkbox } from '../../ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../../ui/dialog'
import { useTranslate } from '@/i18n/use-translate'
import type { LiveSession } from '../../../../../shared/live-sessions/live-session-types'
import { liveSessionTranscriptFiles } from '../../../../../shared/live-sessions/live-session-transcript-files'

export type RemoveLiveSessionsDialogProps = {
  sessions: readonly LiveSession[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onRemoved?: (sessionIds: string[]) => void
  /** Fixtures render the dialog without a main process behind it. */
  remove?: typeof window.api.liveSessions.remove
  defaultDeleteFiles?: boolean
}

const removeThroughMain: typeof window.api.liveSessions.remove = (request) =>
  window.api.liveSessions.remove(request)

export function RemoveLiveSessionsDialog({
  sessions,
  open,
  onOpenChange,
  onRemoved,
  remove = removeThroughMain,
  defaultDeleteFiles = false
}: RemoveLiveSessionsDialogProps): React.JSX.Element {
  const t = useTranslate()
  const [deleteFiles, setDeleteFiles] = useState(defaultDeleteFiles)
  const [busy, setBusy] = useState(false)
  const running = sessions.filter((s) => s.alive).length
  const files = sessions.flatMap((s) => liveSessionTranscriptFiles(s))
  const count = sessions.length

  const confirm = async (stop: boolean) => {
    setBusy(true)
    try {
      const result = await remove({
        sessionIds: sessions.map((s) => s.id),
        stop,
        deleteTranscripts: deleteFiles
      })
      if (result.failed.length > 0) {
        toast.error(
          t(
            'auto.components.live-sessions.remove.failed',
            '{{count}} session(s) could not be removed: they kept running after Seal asked them to stop.',
            { count: result.failed.length }
          )
        )
      }
      onRemoved?.(result.removed)
      onOpenChange(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
    setBusy(false)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="max-w-md sm:max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>
            {count === 1
              ? t('auto.components.live-sessions.remove.titleOne', 'Remove this session from Seal?')
              : t(
                  'auto.components.live-sessions.remove.titleMany',
                  'Remove {{count}} sessions from Seal?',
                  { count }
                )}
          </DialogTitle>
          <DialogDescription>
            {t(
              'auto.components.live-sessions.remove.description',
              'Removed sessions stay hidden, even after Seal rescans. Nothing on disk changes unless you choose to delete transcripts.'
            )}
            {running > 0
              ? ` ${t(
                  'auto.components.live-sessions.remove.running',
                  '{{count}} still running: Stop and remove ends the agent (and its Seal tmux session) first; Remove from Seal leaves it running where it is.',
                  { count: running }
                )}`
              : null}
          </DialogDescription>
        </DialogHeader>
        {files.length > 0 ? (
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={deleteFiles}
                disabled={busy}
                onCheckedChange={(checked) => setDeleteFiles(checked === true)}
              />
              {t(
                'auto.components.live-sessions.remove.deleteFiles',
                'Also delete transcript files'
              )}
            </label>
            {deleteFiles ? (
              <div className="flex flex-col gap-1">
                <p className="text-xs text-destructive">
                  {t(
                    'auto.components.live-sessions.remove.deleteWarning',
                    'These are deleted for good; the conversation cannot be resumed afterwards:'
                  )}
                </p>
                <ul className="scrollbar-sleek max-h-40 overflow-y-auto rounded-md border border-border bg-muted/40 px-2 py-1 font-mono text-2xs text-muted-foreground">
                  {files.map((file) => (
                    <li key={file} className="break-all">
                      {file}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            {t('auto.components.live-sessions.remove.cancel', 'Cancel')}
          </Button>
          {running > 0 ? (
            <>
              {/* A running agent would keep writing the transcript being deleted. */}
              {deleteFiles ? null : (
                <Button variant="outline" disabled={busy} onClick={() => void confirm(false)}>
                  {t('auto.components.live-sessions.remove.hideOnly', 'Remove from Seal')}
                </Button>
              )}
              <Button variant="destructive" disabled={busy} onClick={() => void confirm(true)}>
                {t('auto.components.live-sessions.remove.stopAndRemove', 'Stop and remove')}
              </Button>
            </>
          ) : (
            <Button
              variant={deleteFiles ? 'destructive' : 'default'}
              disabled={busy}
              onClick={() => void confirm(false)}
            >
              {deleteFiles
                ? t('auto.components.live-sessions.remove.removeAndDelete', 'Remove and delete')
                : t('auto.components.live-sessions.remove.hideOnly', 'Remove from Seal')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

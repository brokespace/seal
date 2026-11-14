import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useTranslate, type Translate } from '@/i18n/use-translate'
import { liveSessionTranscriptFiles } from '../../../../../shared/live-sessions/live-session-transcript-files'
import type { LiveSession } from '../../../../../shared/live-sessions/live-session-types'
import { liveSessionTitle } from '../live-session-presentation'
import { sendLiveMessage } from '../live-session-send'
import { liveSessionMarksStore } from '../live-session-marks-store'
import {
  liveSessionDialogStore,
  useLiveSessionDialog,
  type LiveSessionDialog
} from './live-session-dialog-store'
import { removeRequestFor, type LiveSessionDangerKind } from './live-session-menu'

const close = (): void => liveSessionDialogStore.show(null)

function RenameDialog({ session }: { session: LiveSession }): React.JSX.Element {
  const t = useTranslate()
  const [name, setName] = useState(liveSessionTitle(session))
  const save = (customTitle: string | null) => {
    void window.api.liveSessions.annotate({ sessionId: session.id, customTitle })
    close()
  }
  return (
    <DialogContent className="max-w-md sm:max-w-md">
      <DialogHeader>
        <DialogTitle>
          {t('auto.components.live-sessions.rename.title', 'Rename session')}
        </DialogTitle>
        <DialogDescription>
          {t(
            'auto.components.live-sessions.rename.description',
            'The name is kept in Seal; the agent and its transcript are not changed.'
          )}
        </DialogDescription>
      </DialogHeader>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          save(name.trim() || null)
        }}
      >
        <Input
          autoFocus
          value={name}
          maxLength={200}
          onChange={(event) => setName(event.target.value)}
          onFocus={(event) => event.target.select()}
          aria-label={t('auto.components.live-sessions.rename.field', 'Session name')}
        />
        <DialogFooter>
          {session.customTitle ? (
            <Button type="button" variant="ghost" onClick={() => save(null)}>
              {t('auto.components.live-sessions.rename.reset', 'Use the agent’s title')}
            </Button>
          ) : null}
          <Button type="button" variant="outline" onClick={close}>
            {t('auto.components.live-sessions.dialog.cancel', 'Cancel')}
          </Button>
          <Button type="submit">{t('auto.components.live-sessions.rename.save', 'Rename')}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}

function MessageDialog({ session }: { session: LiveSession }): React.JSX.Element {
  const t = useTranslate()
  const [text, setText] = useState('')
  const send = () => {
    if (text.trim()) {
      sendLiveMessage(session.id, text.trim())
      close()
    }
  }
  return (
    <DialogContent className="max-w-md sm:max-w-md">
      <DialogHeader>
        <DialogTitle>
          {t('auto.components.live-sessions.message.title', 'Message {{name}}', {
            name: liveSessionTitle(session)
          })}
        </DialogTitle>
        <DialogDescription>
          {t(
            'auto.components.live-sessions.message.description',
            'Seal types it into the session on {{host}} and tracks it until the agent has it.',
            { host: session.machine.label }
          )}
        </DialogDescription>
      </DialogHeader>
      <Textarea
        autoFocus
        rows={4}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault()
            send()
          }
        }}
        placeholder={t(
          'auto.components.live-sessions.LiveSessionComposer.placeholder',
          'Message this session'
        )}
        className="max-h-60 resize-none"
      />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={close}>
          {t('auto.components.live-sessions.dialog.cancel', 'Cancel')}
        </Button>
        <Button type="button" disabled={!text.trim()} onClick={send}>
          {t('auto.components.live-sessions.LiveSessionComposer.send', 'Send')}
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}

function dangerCopy(
  kind: LiveSessionDangerKind,
  count: number,
  t: Translate
): { title: string; description: string; action: string } {
  switch (kind) {
    case 'stop':
      return {
        title: t('auto.components.live-sessions.danger.stopTitle', 'Stop {{count}} session(s)?', {
          count
        }),
        description: t(
          'auto.components.live-sessions.danger.stopDescription',
          'The agent process ends now, in the middle of whatever it is doing, along with the Seal tmux pane it ran in. The session stays in Seal under Recently finished and can be resumed.'
        ),
        action: t('auto.components.live-sessions.danger.stopAction', 'Stop')
      }
    case 'stop-and-remove':
      return {
        title: t(
          'auto.components.live-sessions.danger.stopRemoveTitle',
          'Stop and remove {{count}} session(s)?',
          { count }
        ),
        description: t(
          'auto.components.live-sessions.danger.stopRemoveDescription',
          'The agent process ends now and the session is hidden from Seal for good, even after a rescan. Its transcript stays on disk.'
        ),
        action: t('auto.components.live-sessions.danger.stopRemoveAction', 'Stop and remove')
      }
    case 'remove':
      return {
        title: t(
          'auto.components.live-sessions.danger.removeTitle',
          'Remove {{count}} session(s) from Seal?',
          { count }
        ),
        description: t(
          'auto.components.live-sessions.danger.removeDescription',
          'Removed sessions stay hidden, even after Seal rescans. A running agent keeps running where it is, and nothing on disk changes.'
        ),
        action: t('auto.components.live-sessions.danger.removeAction', 'Remove from Seal')
      }
    case 'delete-with-transcripts':
      return {
        title: t(
          'auto.components.live-sessions.danger.deleteTitle',
          'Delete {{count}} session(s) and their transcripts?',
          { count }
        ),
        description: t(
          'auto.components.live-sessions.danger.deleteDescription',
          'A running agent is stopped first. These files are deleted for good; the conversation cannot be resumed afterwards:'
        ),
        action: t('auto.components.live-sessions.danger.deleteAction', 'Delete')
      }
  }
}

function DangerDialog({
  danger,
  sessions
}: {
  danger: LiveSessionDangerKind
  sessions: LiveSession[]
}): React.JSX.Element {
  const t = useTranslate()
  const [busy, setBusy] = useState(false)
  const copy = dangerCopy(danger, sessions.length, t)
  const files =
    danger === 'delete-with-transcripts'
      ? sessions.flatMap((session) => liveSessionTranscriptFiles(session))
      : []
  const confirm = async () => {
    setBusy(true)
    try {
      const result = await window.api.liveSessions.remove(removeRequestFor(danger, sessions))
      if (result.failed.length > 0) {
        toast.error(
          t(
            'auto.components.live-sessions.remove.failed',
            '{{count}} session(s) could not be removed: they kept running after Seal asked them to stop.',
            { count: result.failed.length }
          )
        )
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
    setBusy(false)
    // A bulk action is over once it ran.
    liveSessionMarksStore.setPicked(null)
    close()
  }
  return (
    <DialogContent className="max-w-md sm:max-w-md" showCloseButton={false}>
      <DialogHeader>
        <DialogTitle>{copy.title}</DialogTitle>
        <DialogDescription>{copy.description}</DialogDescription>
      </DialogHeader>
      <ul className="scrollbar-sleek max-h-40 overflow-y-auto rounded-md border border-border bg-muted/40 px-2 py-1 text-xs text-muted-foreground">
        {files.length > 0
          ? files.map((file) => (
              <li key={file} className="font-mono text-2xs break-all">
                {file}
              </li>
            ))
          : sessions.map((session) => (
              <li key={session.id} className="truncate">
                {liveSessionTitle(session)} · {session.machine.label}
              </li>
            ))}
      </ul>
      <DialogFooter>
        <Button variant="outline" disabled={busy} onClick={close}>
          {t('auto.components.live-sessions.dialog.cancel', 'Cancel')}
        </Button>
        <Button
          variant={danger === 'remove' ? 'default' : 'destructive'}
          disabled={busy}
          data-testid="live-session-danger-confirm"
          onClick={() => void confirm()}
        >
          {copy.action}
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}

function dialogBody(dialog: LiveSessionDialog): React.JSX.Element {
  switch (dialog.kind) {
    case 'rename':
      return <RenameDialog key={dialog.session.id} session={dialog.session} />
    case 'message':
      return <MessageDialog key={dialog.session.id} session={dialog.session} />
    case 'danger':
      return <DangerDialog danger={dialog.danger} sessions={dialog.sessions} />
  }
}

/** Mounted once: the dialogs session menus open, wherever the menu was. */
export function LiveSessionDialogs(): React.JSX.Element | null {
  const dialog = useLiveSessionDialog()
  if (!dialog) {
    return null
  }
  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      {dialogBody(dialog)}
    </Dialog>
  )
}

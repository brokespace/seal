import { useState } from 'react'
import { Button } from '../../ui/button'
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
import { liveSessionProviderLabel } from '../live-session-presentation'
import { canTakeOver, takeOverLiveSession } from './live-session-take-over'

export function LiveSessionTakeOverButton({
  session
}: {
  session: LiveSession
}): React.JSX.Element | null {
  const t = useTranslate()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  if (!canTakeOver(session)) {
    return null
  }
  const agent = liveSessionProviderLabel(session)
  const resume = session.provider === 'codex' ? 'codex resume' : 'claude --resume'
  const confirm = async () => {
    setBusy(true)
    await takeOverLiveSession(session)
    setBusy(false)
    setConfirming(false)
  }
  return (
    <>
      <Button variant="outline" size="xs" onClick={() => setConfirming(true)}>
        {t('auto.components.live-sessions.takeOver.button', 'Take over')}
      </Button>
      <Dialog open={confirming} onOpenChange={(open) => !busy && setConfirming(open)}>
        <DialogContent className="max-w-sm sm:max-w-sm" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>
              {t('auto.components.live-sessions.takeOver.title', 'Take over this session?')}
            </DialogTitle>
            <DialogDescription>
              {session.alive
                ? t(
                    'auto.components.live-sessions.takeOver.descriptionAlive',
                    'Seal stops {{agent}} on {{host}} (it ends in the terminal it was started from) and reopens the conversation in a Seal pane with {{resume}}. A reply in progress stops.',
                    { agent, host: session.machine.label, resume }
                  )
                : t(
                    'auto.components.live-sessions.takeOver.descriptionClosed',
                    'Seal reopens the conversation in a Seal pane with {{resume}}.',
                    { resume }
                  )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setConfirming(false)}>
              {t('auto.components.live-sessions.takeOver.cancel', 'Cancel')}
            </Button>
            <Button disabled={busy} onClick={() => void confirm()}>
              {t('auto.components.live-sessions.takeOver.confirm', 'Take over')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

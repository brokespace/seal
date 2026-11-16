import type { ConfirmationDialogContextValue } from '@/components/confirmation-dialog-context'
import { translate } from '@/i18n/i18n'
import type { LiveMessage } from '../../../../shared/live-sessions/live-session-types'
import { liveSessionRegistryStore } from './live-session-registry-store'

/** Sends a failed message again; one its session may already have run only after the user agrees it could run twice. */
export async function retryLiveMessage(
  message: LiveMessage,
  confirm: ConfirmationDialogContextValue
): Promise<void> {
  if (message.unconfirmed) {
    const agreed = await confirm({
      title: translate('auto.components.live-sessions.retry.unconfirmedTitle', 'Send it again?'),
      description: translate(
        'auto.components.live-sessions.retry.unconfirmedDescription',
        'Seal could not confirm that the session got this message. It may already have run it, so sending it again could run it twice.'
      ),
      confirmLabel: translate(
        'auto.components.live-sessions.retry.unconfirmedConfirm',
        'Send again'
      ),
      ignoresOpeningGesture: true
    })
    if (!agreed) {
      return
    }
  }
  const retried = await window.api.liveSessions.retry({
    messageId: message.messageId,
    ...(message.unconfirmed && { mayRunTwice: true })
  })
  if (retried) {
    liveSessionRegistryStore.upsertMessage(retried)
  }
}

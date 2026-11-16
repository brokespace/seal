import type { Translate } from '@/i18n/use-translate'
import type { LiveSession } from '../../../../../shared/live-sessions/live-session-types'
import type {
  NativeChatComposerNotice,
  NativeChatComposerNoticeContent
} from '../../native-chat/composer/controls/native-chat-composer-notice'

/** Its process is gone or it said it finished: the transcript stays, a send resumes it. */
export function externalAgentSessionEnded(session: LiveSession): boolean {
  return !session.alive || session.status === 'done'
}

/** Why nothing can be sent now: said by the disabled Send button, and by the field for a running session. */
export function externalAgentSessionSendHold(session: LiveSession, t: Translate): string | null {
  if (session.capabilities.send) {
    return null
  }
  return externalAgentSessionEnded(session)
    ? t('seal.sessionTab.ended', 'This session has ended.')
    : t(
        'auto.components.live-sessions.LiveSessionChat.noRouteTakeOver',
        'Seal can’t type into this session: it runs outside tmux and a Seal pane. Take it over, or install shell integration (Settings › Agents) for next time.'
      )
}

/** What the composer's notice card says about the session, then the last send or answer that failed. */
export function externalAgentSessionComposerNotices({
  session,
  unlisted,
  failure,
  onTakeOver,
  t
}: {
  session: LiveSession | null
  /** The registry no longer lists the record, and what was read of it is still on screen. */
  unlisted: boolean
  failure: (NativeChatComposerNoticeContent & { onDismiss: () => void }) | null
  onTakeOver: (session: LiveSession) => void
  t: Translate
}): NativeChatComposerNotice[] {
  const notices: NativeChatComposerNotice[] = []
  if (!session) {
    if (unlisted) {
      notices.push({
        key: 'session-unavailable',
        kind: 'host',
        tone: 'muted',
        text: t('seal.sessionTab.unavailable', 'This session is no longer available')
      })
    }
  } else if (externalAgentSessionEnded(session)) {
    notices.push({
      key: 'session-ended',
      kind: 'host',
      tone: 'muted',
      text: session.capabilities.send
        ? t('seal.sessionTab.endedResume', 'This session has ended. Send a message to resume it.')
        : t('seal.sessionTab.ended', 'This session has ended.'),
      ...(session.capabilities.takeOver
        ? {
            action: {
              label: t('seal.sessionTab.takeOver', 'Take over'),
              onClick: () => onTakeOver(session)
            }
          }
        : {})
    })
  }
  if (failure) {
    notices.push({ key: 'composer-error', kind: 'error', ...failure })
  }
  return notices
}

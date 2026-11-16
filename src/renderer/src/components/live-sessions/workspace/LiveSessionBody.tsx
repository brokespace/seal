import { useTranslate } from '@/i18n/use-translate'
import { useLiveSessionClock } from '../live-session-clock'
import { useLiveSessions } from '../live-session-registry-store'
import { LiveSessionPane } from './LiveSessionPane'
import { useLiveSessionTabs } from './live-session-tabs-store'

function Notice({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex min-w-0 flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
      {children}
    </div>
  )
}

/** One session's chat, or why there is none to show. The session page and split-view panes draw it. */
export function LiveSessionBody({
  sessionId,
  visible
}: {
  sessionId: string | null
  /** False while the view is kept behind another tab. */
  visible?: boolean
}): React.JSX.Element {
  const t = useTranslate()
  const registry = useLiveSessions()
  const focus = useLiveSessionTabs().focus
  const now = useLiveSessionClock()
  const session = sessionId
    ? (registry.sessions.find((candidate) => candidate.id === sessionId) ?? null)
    : null
  if (session) {
    return (
      <LiveSessionPane
        key={session.id}
        session={session}
        messages={registry.messages}
        focus={focus}
        now={now}
        visible={visible}
      />
    )
  }
  if (sessionId) {
    return (
      <Notice>
        {registry.loaded
          ? t(
              'auto.components.live-sessions.workspace.gone',
              'This session is no longer on its machine. Close the tab, or find it under Recently finished in Active agents.'
            )
          : t('auto.components.live-sessions.workspace.loading', 'Looking for sessions')}
      </Notice>
    )
  }
  return (
    <Notice>
      {t(
        'auto.components.live-sessions.workspace.pick',
        'Pick a session under Active agents in the sidebar to open its chat.'
      )}
    </Notice>
  )
}

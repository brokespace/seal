import { Bot, Sparkles } from 'lucide-react'
import { useSessionMachineName } from '@/components/machines/model/use-local-machine-name'
import { useTranslate } from '@/i18n/use-translate'
import { runningSubagents } from '../../../../../shared/live-sessions/live-session-activity'
import type { LiveSession } from '../../../../../shared/live-sessions/live-session-types'
import { liveSessionProviderLabel, liveSessionTitle } from '../live-session-presentation'
import { LiveSessionStatusPill } from '../status/LiveSessionStatusPill'

/** A session at a glance: where it runs, what it is doing right now, and the last thing it said. */
export function LiveSessionPreview({
  session,
  workspaceName
}: {
  session: LiveSession
  workspaceName: string | null
}): React.JSX.Element {
  const t = useTranslate()
  const machineName = useSessionMachineName()
  const running = runningSubagents(session.activity)
  const current = session.permission?.question ?? session.statusDetail
  return (
    <div data-live-session-preview={session.id} className="flex flex-col gap-2 text-xs">
      <div className="flex flex-col gap-0.5">
        <p className="text-sm font-semibold break-words">{liveSessionTitle(session)}</p>
        <p className="text-muted-foreground">
          {[liveSessionProviderLabel(session), machineName(session.machine), workspaceName]
            .filter(Boolean)
            .join(' \u00b7 ')}
        </p>
      </div>
      <div className="flex flex-col gap-0.5">
        <LiveSessionStatusPill session={session} className="font-medium" />
        {current ? (
          <p className="line-clamp-2 font-mono text-2xs break-all text-muted-foreground">
            {current}
          </p>
        ) : null}
        {running.slice(0, 3).map((subagent) => (
          <p key={subagent.id} className="truncate text-muted-foreground">
            <Bot className="mr-1 inline size-3" />
            {subagent.title}
            {subagent.activity ? ` \u2014 ${subagent.activity}` : ''}
          </p>
        ))}
      </div>
      {session.summary ? (
        <div data-live-session-preview-summary className="flex flex-col gap-0.5">
          <p className="flex items-center gap-1 text-2xs font-semibold tracking-wider text-muted-foreground uppercase">
            <Sparkles className="size-3" aria-hidden />
            {t('seal.sessionSummaries.tooltipSource', 'AI summary of the last message')}
          </p>
          <p className="break-words">{session.summary}</p>
        </div>
      ) : null}
      {session.lastMessage ? (
        <div className="flex flex-col gap-0.5">
          <p className="text-2xs font-semibold tracking-wider text-muted-foreground uppercase">
            {t('auto.components.live-sessions.sidebar.lastMessage', 'Last message')}
          </p>
          <p className="line-clamp-4 break-words">{session.lastMessage}</p>
        </div>
      ) : null}
      {session.cwd ? (
        <p className="truncate font-mono text-2xs text-muted-foreground">{session.cwd}</p>
      ) : null}
    </div>
  )
}

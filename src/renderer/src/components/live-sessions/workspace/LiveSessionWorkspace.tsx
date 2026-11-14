import { X } from 'lucide-react'
import { AgentStateDot } from '@/components/AgentStateDot'
import { AgentIcon } from '@/components/agent/icons/AgentIcon'
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '@/components/ui/context-menu'
import { cn } from '@/lib/class-names'
import { useTranslate } from '@/i18n/use-translate'
import type { LiveSession } from '../../../../../shared/live-sessions/live-session-types'
import { useLiveSessionClock } from '../live-session-clock'
import {
  liveSessionDotState,
  liveSessionStatusText,
  liveSessionTitle
} from '../live-session-presentation'
import { useLiveSessions } from '../live-session-registry-store'
import { CONTEXT_MENU_KIT, LiveSessionMenuItems } from '../menu/LiveSessionMenuItems'
import { LiveSessionPane } from './LiveSessionPane'
import { liveSessionTabsStore, useLiveSessionTabs } from './live-session-tabs-store'

function SessionTab({
  sessionId,
  session,
  active,
  preview
}: {
  sessionId: string
  session: LiveSession | null
  active: boolean
  preview: boolean
}): React.JSX.Element {
  const t = useTranslate()
  const title = session
    ? liveSessionTitle(session)
    : t('auto.components.live-sessions.workspace.goneTab', 'Session ended')
  const tab = (
    <div
      role="tab"
      tabIndex={0}
      aria-selected={active}
      data-live-session-tab={sessionId}
      title={session ? `${title} \u2014 ${liveSessionStatusText(session)}` : title}
      onClick={() => liveSessionTabsStore.activate(sessionId)}
      onDoubleClick={() => liveSessionTabsStore.keep(sessionId)}
      onAuxClick={(event) => {
        if (event.button === 1) {
          liveSessionTabsStore.close(sessionId)
        }
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          liveSessionTabsStore.activate(sessionId)
        }
      }}
      className={cn(
        'group flex h-8 max-w-56 min-w-0 shrink-0 cursor-pointer items-center gap-1.5 border-r border-border px-2.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
        active
          ? 'bg-background text-foreground'
          : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
      )}
    >
      {session ? (
        <>
          <AgentIcon agent={session.provider} size={13} />
          <AgentStateDot state={liveSessionDotState(session.status)} title={null} />
        </>
      ) : null}
      <span className={cn('min-w-0 truncate', preview && 'italic')}>{title}</span>
      <button
        type="button"
        aria-label={t('auto.components.live-sessions.workspace.closeTab', 'Close tab')}
        onClick={(event) => {
          event.stopPropagation()
          liveSessionTabsStore.close(sessionId)
        }}
        className={cn(
          'flex size-4 shrink-0 items-center justify-center rounded-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
          !active && 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
        )}
      >
        <X className="size-3" />
      </button>
    </div>
  )
  if (!session) {
    return tab
  }
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{tab}</ContextMenuTrigger>
      <ContextMenuContent>
        <LiveSessionMenuItems session={session} kit={CONTEXT_MENU_KIT} />
      </ContextMenuContent>
    </ContextMenu>
  )
}

function Notice({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex min-w-0 flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
      {children}
    </div>
  )
}

/** The main area while agent sessions are open: their tabs, and one or two of them side by side. */
export default function LiveSessionWorkspace(): React.JSX.Element {
  const t = useTranslate()
  const registry = useLiveSessions()
  const tabs = useLiveSessionTabs()
  const now = useLiveSessionClock()
  const byId = new Map(registry.sessions.map((session) => [session.id, session]))
  const active = tabs.activeId ? (byId.get(tabs.activeId) ?? null) : null
  const split = tabs.splitId ? (byId.get(tabs.splitId) ?? null) : null

  return (
    <main
      data-live-session-workspace
      className="relative flex h-full min-h-0 flex-1 flex-col bg-background text-foreground"
    >
      {tabs.tabs.length > 0 ? (
        <div
          role="tablist"
          aria-label={t('auto.components.live-sessions.workspace.tabs', 'Open agent sessions')}
          className="scrollbar-sleek flex shrink-0 overflow-x-auto border-b border-border bg-muted/40"
          style={{ paddingRight: 'var(--window-controls-width, 0px)' }}
        >
          {tabs.tabs.map((sessionId) => (
            <SessionTab
              key={sessionId}
              sessionId={sessionId}
              session={byId.get(sessionId) ?? null}
              active={sessionId === tabs.activeId || sessionId === tabs.splitId}
              preview={sessionId === tabs.previewId}
            />
          ))}
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1">
        {active ? (
          <LiveSessionPane
            key={active.id}
            session={active}
            messages={registry.messages}
            focus={tabs.focus}
            now={now}
          />
        ) : tabs.activeId ? (
          <Notice>
            {registry.loaded
              ? t(
                  'auto.components.live-sessions.workspace.gone',
                  'This session is no longer on its machine. Close the tab, or find it under Recently finished in Active agents.'
                )
              : t('auto.components.live-sessions.workspace.loading', 'Looking for sessions')}
          </Notice>
        ) : (
          <Notice>
            {t(
              'auto.components.live-sessions.workspace.pick',
              'Pick a session under Active agents in the sidebar to open its chat.'
            )}
          </Notice>
        )}
        {split ? (
          <div className="flex min-h-0 min-w-0 flex-1 border-l border-border">
            <LiveSessionPane
              key={split.id}
              session={split}
              messages={registry.messages}
              focus={tabs.focus}
              now={now}
              onCloseSplit={() => liveSessionTabsStore.closeSplit()}
            />
          </div>
        ) : null}
      </div>
    </main>
  )
}

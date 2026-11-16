import { useMemo } from 'react'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ItemSurfaceSlot } from '@/components/split-view/ItemSurfaceSlot'
import type { ItemTabCommands } from '@/components/split-view/item-tab-commands'
import { ItemTabBar } from '@/components/split-view/ItemTabBar'
import { ItemTabDragLayer } from '@/components/split-view/ItemTabDragLayer'
import { splitViewItemKey, type SplitViewTab } from '@/components/split-view/split-view-types'
import { resolveProjectOverviewRepo } from '@/components/project-overview/project-overview-model'
import { useAppStore } from '@/store'
import { useTranslate } from '@/i18n/use-translate'
import { closeLiveSessionView } from '../menu/live-session-menu-effects'
import { LiveSessionBody } from './LiveSessionBody'
import { liveSessionTabsStore, useLiveSessionTabs } from './live-session-tabs-store'

/** The way back to the project overview a session was opened from; every other origin is in the sidebar. */
function BackToProjectOverview(): React.JSX.Element {
  const t = useTranslate()
  const project = useAppStore((s) => resolveProjectOverviewRepo(s.repos, s.projectOverviewTarget))
  const back = useAppStore((s) => s.closeAgentSessionTabs)
  const label = project
    ? t('auto.components.live-sessions.workspace.backToProject', 'Back to {{project}}', {
        project: project.displayName
      })
    : t('auto.components.live-sessions.workspace.backToProjectOverview', 'Back to project overview')
  return (
    // In a narrow column the label gives way to the tabs; the arrow stays.
    <div className="flex h-8 min-w-9 items-center border-r border-border px-1">
      <Button
        type="button"
        variant="ghost"
        size="xs"
        data-live-session-back-to-project
        aria-label={label}
        title={label}
        onClick={back}
        className="max-w-56 min-w-0 shrink justify-start overflow-hidden"
      >
        <ArrowLeft className="size-3.5 shrink-0" />
        {/* Too little room for a letter and its ellipsis would cut a glyph in half. */}
        <span className="min-w-0 truncate @max-[10rem]/session-tabs:hidden">{label}</span>
      </Button>
    </div>
  )
}

const SESSION_TAB_COMMANDS: ItemTabCommands = {
  activate: (item) => item.kind === 'session' && liveSessionTabsStore.activate(item.sessionId),
  keep: (item) => item.kind === 'session' && liveSessionTabsStore.keep(item.sessionId),
  close: (item) => item.kind === 'session' && closeLiveSessionView(item.sessionId)
}

/** The main area while agent sessions are open: their tabs, and the active one's chat. */
export default function LiveSessionWorkspace(): React.JSX.Element {
  const t = useTranslate()
  const tabs = useLiveSessionTabs()
  const openedFromProject = useAppStore((s) => s.previousViewBeforeSessions === 'project')
  const itemTabs = useMemo(
    () =>
      tabs.tabs.map((sessionId): SplitViewTab => ({
        item: { kind: 'session', sessionId },
        preview: sessionId === tabs.previewId
      })),
    [tabs.tabs, tabs.previewId]
  )

  return (
    <main
      data-live-session-workspace
      className="relative flex h-full min-h-0 flex-1 flex-col bg-background text-foreground"
    >
      {openedFromProject || tabs.tabs.length > 0 ? (
        <ItemTabDragLayer>
          <ItemTabBar
            paneId={null}
            tabs={itemTabs}
            activeKey={
              tabs.activeId ? splitViewItemKey({ kind: 'session', sessionId: tabs.activeId }) : null
            }
            label={t('auto.components.live-sessions.workspace.tabs', 'Open agent sessions')}
            commands={SESSION_TAB_COMMANDS}
            before={openedFromProject ? <BackToProjectOverview /> : null}
            style={{ paddingRight: 'var(--window-controls-width, 0px)' }}
          />
        </ItemTabDragLayer>
      ) : null}
      {tabs.activeId ? (
        <ItemSurfaceSlot />
      ) : (
        <div className="flex min-h-0 flex-1">
          <LiveSessionBody sessionId={null} />
        </div>
      )}
    </main>
  )
}

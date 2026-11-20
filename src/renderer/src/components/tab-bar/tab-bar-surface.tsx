import React from 'react'
import { Plus } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import type { Translate } from '@/i18n/use-translate'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { ProjectedAgentMenuItems } from './QuickLaunchButton'
import { TabBarAgentPickerEntry } from './TabBarAgentPickerEntry'
import { TabStripViewport } from './TabStripViewport'
import type { useTabStripOverflowNavigation } from './tab-strip-overflow-navigation'
import type { useTabStripDragScrollHandlers } from './tab-strip-drag-scroll'
import type { TabBarProps } from './tab-bar-props'
import type { TabBarRuntimeModel } from './use-tab-bar-runtime-model'
import type { TabBarCreateMenuController } from './use-tab-bar-create-menu-controller'
import type { TabBarItemProjection } from './use-tab-bar-item-projection'
import type { TabBarItemActions } from './use-tab-bar-item-actions'
import { renderTabBarItems } from './tab-bar-item-surface'
import { TabBarStaticCreateMenu } from './tab-bar-static-create-menu'
import ClientHostedBrowserTabRows from './ClientHostedBrowserTabRows'
import type { ClientHostedBrowserRow } from '../../../../shared/client-hosted-browser-rows'
import { advanceAgentSessionsTourPastNewTab } from '@/components/contextual-tours/agent-sessions-tour-new-tab'

const EMPTY_CLIENT_HOSTED_ROWS: readonly ClientHostedBrowserRow[] = []

export function renderTabBarSurface(
  {
    props,
    runtime,
    createMenu,
    itemProjection,
    tabStripNavigation,
    tabStripDragScroll,
    activeClientHostedBrowserRowId,
    itemActions,
    surfaceRef
  }: {
    props: TabBarProps
    runtime: TabBarRuntimeModel
    createMenu: TabBarCreateMenuController
    itemProjection: TabBarItemProjection
    tabStripNavigation: ReturnType<typeof useTabStripOverflowNavigation>
    tabStripDragScroll: ReturnType<typeof useTabStripDragScrollHandlers>
    activeClientHostedBrowserRowId: string | null
    itemActions: TabBarItemActions
    surfaceRef: (node: HTMLDivElement | null) => void
  },
  t: Translate = translate
): React.JSX.Element {
  const {
    worktreeId,
    terminalOnly = false,
    showAgentLaunchItems = true,
    onNewTerminalTab,
    onOpenEntry,
    tabStripChrome = 'default'
  } = props
  const {
    resolvedGroupId,
    mobileEmulatorEnabled,
    managedBrowserCreationEnabled,
    mobileEmulatorCreationEnabled,
    workspaceHasSimulatorTab,
    showMobileEmulatorIntroCallout,
    windowsTerminalCapabilities,
    defaultWindowsPowerShellImplementation,
    newTerminalShortcut,
    newBrowserShortcut,
    newSimulatorShortcut,
    newFileShortcut,
    openMarkdownShortcut
  } = runtime
  const {
    agentMenu,
    agentPickerInventory,
    selectPickerAgent,
    launchAgentRow,
    newTabMenuOpen,
    setNewTabMenuOpen,
    setCreateMenuQuery,
    createMenuOptions,
    windowsShellEntries,
    handleSelectCreateMenuOption,
    launchAgentFromNewTabEntry,
    runPendingNewTabMenuFocusAfterClose,
    noteNewTabMenuEscape,
    takeNewTabMenuEscape,
    queueNewActiveTerminalFocusAfterNewTabMenuClose,
    queueFocusAfterNewTabMenuClose,
    showStaticCreateMenuItems
  } = createMenu
  const { orderedItems, sortableIds, dropIndicatorByVisibleId } = itemProjection
  const clientHostedBrowserRows = props.clientHostedBrowserRows ?? EMPTY_CLIENT_HOSTED_ROWS
  const singleTab = orderedItems.length + clientHostedBrowserRows.length === 1
  const includeTopTabBorder = tabStripChrome !== 'floating-panel'
  const renderedItems = renderTabBarItems({
    items: orderedItems,
    props,
    runtime,
    actions: itemActions,
    dropIndicatorByVisibleId,
    includeTopTabBorder,
    activeClientHostedBrowserRowId
  })

  const hasTabs = orderedItems.length + clientHostedBrowserRows.length > 0
  return (
    <div ref={surfaceRef} className="flex items-stretch h-full overflow-hidden flex-1 min-w-0">
      <TabStripViewport
        sortableIds={sortableIds}
        navigation={tabStripNavigation}
        dragScroll={tabStripDragScroll}
        singleTab={singleTab}
        hasTabs={hasTabs}
      >
        {renderedItems}
        {clientHostedBrowserRows.length > 0 ? (
          <ClientHostedBrowserTabRows
            rows={clientHostedBrowserRows}
            worktreeId={worktreeId}
            groupId={resolvedGroupId}
            groupActiveTabId={props.groupActiveTabId ?? null}
            includeTopTabBorder={includeTopTabBorder}
          />
        ) : null}
      </TabStripViewport>
      <DropdownMenu
        open={newTabMenuOpen}
        onOpenChange={setNewTabMenuOpen}
        // Why: modal would disable body pointer events, making the Mobile Emulator "Hide" re-enable toast unclickable.
        modal={false}
      >
        <DropdownMenuTrigger asChild>
          {/* Why: below 86px (40 tab floor + 36 "+" + 8 action padding + 2 sub-pixel slack) "+" would only clip; hide it whole so Tab never lands on it. Empty groups keep it. */}
          <button
            className={`ml-2 my-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent/50 hover:text-foreground ${
              hasTabs ? '@max-[86px]/tab-strip:hidden' : ''
            }`}
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            title={t('auto.components.tab.bar.TabBar.b1a132357f', 'New tab')}
            aria-label={t('auto.components.tab.bar.TabBar.b1a132357f', 'New tab')}
            data-contextual-tour-target="tab-create-menu"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          sideOffset={6}
          className="w-96 max-w-[calc(100vw-1rem)]"
          onEscapeKeyDown={noteNewTabMenuEscape}
          onCloseAutoFocus={(event) => {
            // Why: Radix restores focus to the "+" trigger on close, stealing it from the freshly-mounted terminal. Esc opened nothing, so the trigger keeps the keyboard.
            if (!takeNewTabMenuEscape()) {
              event.preventDefault()
            }
            runPendingNewTabMenuFocusAfterClose()
            advanceAgentSessionsTourPastNewTab()
          }}
        >
          {!terminalOnly && onOpenEntry ? (
            <>
              <TabBarAgentPickerEntry
                inventory={agentPickerInventory}
                terminalPending={agentMenu.state === 'settled' && agentMenu.terminalPending}
                worktreeId={worktreeId}
                groupId={resolvedGroupId}
                menuOpen={newTabMenuOpen}
                menuOptions={createMenuOptions}
                onLaunchAgentOption={launchAgentFromNewTabEntry}
                onOpenDefaultTerminal={() => {
                  queueNewActiveTerminalFocusAfterNewTabMenuClose()
                  onNewTerminalTab()
                }}
                onOpenEntry={onOpenEntry}
                onQueryChange={setCreateMenuQuery}
                onQueueSwitchFocus={queueFocusAfterNewTabMenuClose}
                onSelectMenuOption={handleSelectCreateMenuOption}
                onDidOpenEntry={() => setNewTabMenuOpen(false)}
              />
              {showStaticCreateMenuItems ? <DropdownMenuSeparator /> : null}
            </>
          ) : null}
          {showStaticCreateMenuItems ? (
            <TabBarStaticCreateMenu
              props={props}
              groupId={resolvedGroupId}
              terminalOnly={terminalOnly}
              mobileEmulatorEnabled={mobileEmulatorEnabled}
              managedBrowserCreationEnabled={managedBrowserCreationEnabled}
              mobileEmulatorCreationEnabled={mobileEmulatorCreationEnabled}
              workspaceHasSimulatorTab={workspaceHasSimulatorTab}
              showMobileEmulatorIntroCallout={showMobileEmulatorIntroCallout}
              windowsShellEntries={windowsShellEntries}
              defaultWindowsPowerShellImplementation={defaultWindowsPowerShellImplementation}
              pwshAvailable={windowsTerminalCapabilities.pwshAvailable}
              newTerminalShortcut={newTerminalShortcut}
              newBrowserShortcut={newBrowserShortcut}
              newSimulatorShortcut={newSimulatorShortcut}
              newFileShortcut={newFileShortcut}
              openMarkdownShortcut={openMarkdownShortcut}
              queueNewActiveTerminalFocusAfterNewTabMenuClose={
                queueNewActiveTerminalFocusAfterNewTabMenuClose
              }
            />
          ) : null}
          {showStaticCreateMenuItems && showAgentLaunchItems ? (
            <>
              <DropdownMenuSeparator />
              <ProjectedAgentMenuItems
                model={agentMenu}
                pickerInventory={agentPickerInventory}
                onSelectPickerAgent={selectPickerAgent}
                hidePickerSearch={!terminalOnly && Boolean(onOpenEntry)}
                runLaunch={launchAgentRow}
              />
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

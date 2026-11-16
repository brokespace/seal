import { useCallback, useMemo, useState } from 'react'
import { Server } from 'lucide-react'
import { useTranslate } from '@/i18n/use-translate'
import { Button } from '../ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover'
import { HostListOverflowNote } from '../host-picker/HostListOverflowNote'
import { HostListSearchField } from '../host-picker/HostListSearchField'
import { useBoundedHostRows } from '../host-picker/use-bounded-host-rows'
import { MachineStatusDot, useMachineStatusLabel } from '../machines/detail/MachineVitals'
import { NativeChatContextUsageRing } from '../native-chat/usage/NativeChatContextUsageRing'
import type { NativeChatContextUsageRingInput } from '../native-chat/usage/native-chat-context-usage-ring-input'
import type {
  HomeChatMachineOption,
  HomeChatSummary
} from '../../../../shared/home-chat/home-chat-types'

function MachinesPopover({
  current,
  machines,
  onOpen
}: {
  current: string | null
  machines: readonly HomeChatMachineOption[]
  onOpen: () => void
}): React.JSX.Element {
  const t = useTranslate()
  const statusLabel = useMachineStatusLabel()
  const local = machines.find((machine) => machine.kind === 'local')
  const label = current ?? local?.label ?? t('homeChat.context.thisComputer', 'This computer')
  const online = machines.filter((machine) => machine.status === 'online').length
  const rows = useBoundedHostRows(machines)

  return (
    <Popover onOpenChange={(open) => open && onOpen()}>
      <PopoverTrigger asChild>
        <Button
          size="xs"
          variant="muted-field-icon"
          className="min-w-0"
          data-home-chat-machine={label}
          aria-label={t('homeChat.context.machine', 'Machine: {{machine}}', { machine: label })}
        >
          <Server />
          <span className="max-w-40 truncate">{label}</span>
          {machines.length > 1 && (
            <span className="tabular-nums text-muted-foreground/70">
              {t('homeChat.context.online', '· {{online}} of {{total}} machines online', {
                online,
                total: machines.length
              })}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72">
        <p className="px-3 pt-2 pb-1 text-xs font-medium text-muted-foreground">
          {t('homeChat.context.machinesTitle', 'Machines the assistant can reach')}
        </p>
        {rows.searchable && <HostListSearchField value={rows.query} onChange={rows.setQuery} />}
        <ul className="scrollbar-sleek max-h-64 space-y-0.5 overflow-y-auto px-2 pb-2">
          {rows.shown.map((machine) => (
            <li
              key={machine.id}
              className="flex items-center gap-2 rounded-md px-1 py-1 text-xs"
              data-home-chat-machine-row={machine.label}
            >
              <MachineStatusDot status={machine.status} />
              <span className="min-w-0 flex-1 truncate text-foreground">{machine.label}</span>
              {machine.address && (
                <span className="max-w-28 truncate font-mono text-muted-foreground">
                  {machine.address}
                </span>
              )}
              <span className="shrink-0 text-muted-foreground">{statusLabel(machine.status)}</span>
            </li>
          ))}
        </ul>
        <HostListOverflowNote hiddenCount={rows.hiddenCount} />
      </PopoverContent>
    </Popover>
  )
}

/** Runs the thread's compaction; settles when it has finished, or at once when there is no thread. */
type HomeChatCompact = () => Promise<unknown> | undefined

type WatchedCompaction = { chatId: string; count: number; lastCompactedAt?: number }

/** The thread summary carries a compaction count and no time, so the ring times what it sees happen. */
function useLastWatchedCompaction(chat: HomeChatSummary): number | undefined {
  const { id: chatId, updatedAt } = chat
  const count = chat.context.compactions
  const [watch, setWatch] = useState<WatchedCompaction>({ chatId, count })
  if (watch.chatId !== chatId) {
    setWatch({ chatId, count })
  } else if (watch.count !== count) {
    setWatch({
      chatId,
      count,
      lastCompactedAt: count > watch.count ? updatedAt : watch.lastCompactedAt
    })
  }
  return watch.lastCompactedAt
}

function ContextRing({
  chat,
  onCompact
}: {
  chat: HomeChatSummary
  onCompact: HomeChatCompact
}): React.JSX.Element {
  const t = useTranslate()
  const { usedTokens, windowTokens, compactions } = chat.context
  const percentage = windowTokens > 0 ? Math.round((usedTokens / windowTokens) * 100) : 0
  const compactDisabled = chat.status === 'running'
  const lastCompactedAt = useLastWatchedCompaction(chat)
  // The thread whose compaction this ring started and has not seen finish.
  const [compactingChatId, setCompactingChatId] = useState<string | null>(null)
  const chatId = chat.id
  const compact = useCallback(() => {
    const finished = onCompact()
    if (!finished) {
      return
    }
    setCompactingChatId(chatId)
    void finished.finally(() =>
      setCompactingChatId((current) => (current === chatId ? null : current))
    )
  }, [onCompact, chatId])
  const compacting = compactingChatId === chatId
  const usage = useMemo<NativeChatContextUsageRingInput>(
    () => ({
      usedTokens,
      windowTokens,
      percentage,
      // The thread summary does not say whether a provider measured its size; most drivers estimate it.
      estimated: true,
      rows: [],
      compactions,
      ...(lastCompactedAt === undefined ? {} : { lastCompactedAt }),
      compacting,
      onCompact: compact,
      compactDisabled
    }),
    [
      usedTokens,
      windowTokens,
      percentage,
      compactions,
      lastCompactedAt,
      compacting,
      compact,
      compactDisabled
    ]
  )

  return (
    <div className="flex" data-home-chat-context={percentage}>
      <NativeChatContextUsageRing
        usage={usage}
        cardSide="bottom"
        note={
          // The description states a share of the window, so it waits for a measured one.
          windowTokens > 0 ? (
            <p className="text-2xs text-muted-foreground" data-home-chat-compactions={compactions}>
              {t(
                'homeChat.context.description',
                'What the model reads on its next turn: {{percent}}% of its window. When it fills, Seal summarizes older messages for the model; the thread you see stays complete.',
                { percent: percentage }
              )}
            </p>
          ) : undefined
        }
      />
    </div>
  )
}

/** Where the assistant is working and how full the model's context is. */
export function HomeChatContextBar({
  chat,
  machines,
  onOpenMachines,
  onCompact
}: {
  chat: HomeChatSummary | null
  machines: readonly HomeChatMachineOption[]
  onOpenMachines: () => void
  onCompact: HomeChatCompact
}): React.JSX.Element {
  return (
    <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border px-2">
      <MachinesPopover
        current={chat?.lastMachine ?? null}
        machines={machines}
        onOpen={onOpenMachines}
      />
      <div className="flex-1" />
      {chat && <ContextRing chat={chat} onCompact={onCompact} />}
    </div>
  )
}

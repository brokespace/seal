import { Gauge, Server } from 'lucide-react'
import { useTranslate } from '@/i18n/use-translate'
import { Button } from '../ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover'
import { Progress } from '../ui/progress'
import { MachineStatusDot, useMachineStatusLabel } from '../machines/detail/MachineVitals'
import type {
  HomeChatMachineOption,
  HomeChatSummary
} from '../../../../shared/home-chat/home-chat-types'
import { formatHomeChatTokens } from './home-chat-format'

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

  return (
    <Popover onOpenChange={(open) => open && onOpen()}>
      <PopoverTrigger asChild>
        <Button
          size="xs"
          variant="ghost"
          className="min-w-0 text-muted-foreground"
          data-home-chat-machine={label}
          aria-label={t('homeChat.context.machine', 'Machine: {{machine}}', { machine: label })}
        >
          <Server />
          <span className="max-w-40 truncate">{label}</span>
          {machines.length > 1 && (
            <span className="tabular-nums">
              {t('homeChat.context.online', '{{online}}/{{total}} online', {
                online,
                total: machines.length
              })}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-2">
        <p className="px-1 pb-1 text-xs font-medium text-muted-foreground">
          {t('homeChat.context.machinesTitle', 'Machines the assistant can reach')}
        </p>
        <ul className="scrollbar-sleek max-h-64 space-y-0.5 overflow-y-auto">
          {machines.map((machine) => (
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
      </PopoverContent>
    </Popover>
  )
}

function ContextPopover({
  chat,
  onCompact
}: {
  chat: HomeChatSummary
  onCompact: () => void
}): React.JSX.Element {
  const t = useTranslate()
  const { usedTokens, windowTokens, compactions } = chat.context
  const percent =
    windowTokens > 0 ? Math.min(100, Math.round((usedTokens / windowTokens) * 100)) : 0
  const usage = t('homeChat.context.usage', '{{used}} / {{window}}', {
    used: formatHomeChatTokens(usedTokens),
    window: formatHomeChatTokens(windowTokens)
  })

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          size="xs"
          variant="ghost"
          className="text-muted-foreground"
          data-home-chat-context={percent}
          aria-label={t('homeChat.context.label', 'Context: {{usage}} tokens', { usage })}
        >
          <Gauge />
          <span className="tabular-nums">{usage}</span>
          <Progress value={percent} className="h-1 w-12" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-2 p-3">
        <p className="text-sm font-medium">{t('homeChat.context.title', 'Context')}</p>
        <p className="text-xs text-muted-foreground">
          {t(
            'homeChat.context.description',
            'What the model reads on its next turn: {{percent}}% of its window. When it fills, Seal summarizes older messages for the model; the thread you see stays complete.',
            { percent }
          )}
        </p>
        {compactions > 0 && (
          <p className="text-xs text-muted-foreground" data-home-chat-compactions={compactions}>
            {t('homeChat.context.compactions', 'Summarized {{count}} times so far.', {
              count: compactions
            })}
          </p>
        )}
        <Button
          size="sm"
          variant="outline"
          disabled={chat.status === 'running'}
          onClick={onCompact}
        >
          {t('homeChat.context.compactNow', 'Summarize older messages now')}
        </Button>
      </PopoverContent>
    </Popover>
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
  onCompact: () => void
}): React.JSX.Element {
  return (
    <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border px-2">
      <MachinesPopover
        current={chat?.lastMachine ?? null}
        machines={machines}
        onOpen={onOpenMachines}
      />
      <div className="flex-1" />
      {chat && chat.context.windowTokens > 0 && (
        <ContextPopover chat={chat} onCompact={onCompact} />
      )}
    </div>
  )
}

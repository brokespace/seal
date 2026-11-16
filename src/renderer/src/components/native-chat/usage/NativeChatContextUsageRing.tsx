import { useCallback, useEffect, useRef, useState } from 'react'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import { useLiveSessionClock } from '@/components/live-sessions/live-session-clock'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useTranslate } from '@/i18n/use-translate'
import { cn } from '@/lib/class-names'
import {
  contextUsageRingReadout,
  isContextUsageMeasured,
  type NativeChatContextUsageState
} from '../../../../../shared/native-chat/native-chat-context-usage-state'
import { contextUsageStateText, NativeChatContextUsageCard } from './NativeChatContextUsageCard'
import type { NativeChatContextUsageRingInput } from './native-chat-context-usage-ring-input'

const RING_SIZE = 16
const RING_STROKE = 2
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS
/** Long enough that a pointer crossing the ring toward dictation doesn't flash the card. */
const HOVER_OPEN_DELAY_MS = 150
/** Long enough for the pointer to cross the gap between the ring and the card. */
const HOVER_CLOSE_DELAY_MS = 100

/** Card open state where only mouse hover waits, to open and to close; any explicit change drops a pending hover. */
function useContextCardOpen(): {
  open: boolean
  setOpen: (next: boolean) => void
  setOpenAfterHover: (next: boolean) => void
} {
  const [open, setOpenState] = useState(false)
  const cancelPendingHover = useRef<(() => void) | null>(null)
  const dropPendingHover = useCallback((): void => {
    cancelPendingHover.current?.()
    cancelPendingHover.current = null
  }, [])
  useEffect(() => dropPendingHover, [dropPendingHover])
  const setOpen = useCallback(
    (next: boolean): void => {
      dropPendingHover()
      setOpenState(next)
    },
    [dropPendingHover]
  )
  const setOpenAfterHover = useCallback(
    (next: boolean): void => {
      dropPendingHover()
      // The card isn't mounted yet, so its own Escape handling can't cancel a pending open.
      const onKeyDown = (event: KeyboardEvent): void => {
        if (event.key === 'Escape') {
          dropPendingHover()
        }
      }
      const timer = setTimeout(
        () => setOpen(next),
        next ? HOVER_OPEN_DELAY_MS : HOVER_CLOSE_DELAY_MS
      )
      document.addEventListener('keydown', onKeyDown, true)
      cancelPendingHover.current = () => {
        clearTimeout(timer)
        document.removeEventListener('keydown', onKeyDown, true)
      }
    },
    [dropPendingHover, setOpen]
  )
  return { open, setOpen, setOpenAfterHover }
}

const RING_TONE: Partial<Record<NativeChatContextUsageState, string>> = {
  near: 'text-status-warning',
  critical: 'text-destructive'
}
/** Raw amber is too faint for small text on a light canvas, so the words take the text token. */
const STATE_TEXT_TONE: Partial<Record<NativeChatContextUsageState, string>> = {
  near: 'text-status-warning-text'
}
/** Short enough that "Compacted" clears close to the end of its minute. */
const CLOCK_TICK_MS = 10_000

function ContextUsageArc({ filled }: { filled: number }): React.JSX.Element {
  return (
    <svg
      width={RING_SIZE}
      height={RING_SIZE}
      viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
      aria-hidden="true"
      className="shrink-0 -rotate-90"
    >
      <circle
        cx={RING_SIZE / 2}
        cy={RING_SIZE / 2}
        r={RING_RADIUS}
        fill="none"
        stroke="currentColor"
        strokeWidth={RING_STROKE}
        className="opacity-25"
      />
      <circle
        cx={RING_SIZE / 2}
        cy={RING_SIZE / 2}
        r={RING_RADIUS}
        fill="none"
        stroke="currentColor"
        strokeWidth={RING_STROKE}
        strokeLinecap="round"
        strokeDasharray={RING_CIRCUMFERENCE}
        className="transition-[stroke-dashoffset] duration-300 ease-out motion-reduce:transition-none"
        style={{ strokeDashoffset: RING_CIRCUMFERENCE * (1 - filled / 100) }}
      />
    </svg>
  )
}

/** Composer ring for context-window usage and compaction; hover, click, tap, or Enter shows the breakdown. */
export function NativeChatContextUsageRing({
  usage,
  note
}: {
  usage: NativeChatContextUsageRingInput
  /** Shown last in the card, for what only the surface holding the ring can explain. */
  note?: React.ReactNode
}): React.JSX.Element {
  const t = useTranslate()
  const now = useLiveSessionClock(CLOCK_TICK_MS)
  const readout = contextUsageRingReadout(usage, { compacting: usage.compacting === true, now })
  const { state } = readout
  const stateText = contextUsageStateText(state, t)
  const measured = isContextUsageMeasured(usage)
  const usageLabel = measured
    ? t(
        'components.native-chat.contextUsage.label',
        'Context {{used}} of {{window}} tokens, {{percent}}% used',
        { used: readout.used, window: readout.window, percent: String(usage.percentage) }
      )
    : t('seal.contextIndicator.empty', 'Context usage appears after the first reply.')
  const label =
    stateText === null ? usageLabel : [usageLabel, stateText].join(measured ? ', ' : ' ')
  const { open, setOpen, setOpenAfterHover } = useContextCardOpen()
  return (
    <div
      className="flex"
      // Only mouse hover drives delays; touch leaves before click, and portal entry must cancel pending close.
      onPointerEnter={(event) => {
        if (event.pointerType === 'mouse') {
          setOpenAfterHover(true)
        }
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === 'mouse') {
          setOpenAfterHover(false)
        }
      }}
      onContextMenu={() => setOpen(false)}
    >
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={label}
            aria-expanded={open}
            data-native-chat-context-usage={usage.percentage}
            data-native-chat-context-usage-estimated={usage.estimated ? 'true' : undefined}
            data-native-chat-context-state={state}
            className={cn(
              'relative flex h-7 min-w-7 items-center justify-center gap-1.5 rounded-md px-1.5 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:h-11 pointer-coarse:min-w-11',
              RING_TONE[state] ?? 'text-muted-foreground hover:text-accent-foreground'
            )}
            // A read-only readout: clicking it must not pull focus out of the composer.
            onMouseDown={(event) => event.preventDefault()}
            onClick={(event) => {
              // Open, never toggle: a hover already opened it, and a click must not close it.
              event.preventDefault()
              setOpen(true)
            }}
          >
            {state === 'compacting' ? (
              <LoadingSpinner className="size-4 shrink-0" />
            ) : (
              <ContextUsageArc filled={readout.filled} />
            )}
            {stateText === null ? null : (
              <span
                data-composer-label
                data-native-chat-context-text=""
                // Anchored inside the ring, so the hidden copy a narrow toolbar keeps cannot widen the composer.
                className={cn('right-0 text-xs whitespace-nowrap', STATE_TEXT_TONE[state])}
              >
                {stateText}
              </span>
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent
          aria-label={label}
          data-native-chat-context-card=""
          side="top"
          align="end"
          sideOffset={8}
          className="w-72"
          onOpenAutoFocus={(event) => event.preventDefault()}
          // Closing on pointer leave or Escape would otherwise focus the ring and strand typing.
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          <NativeChatContextUsageCard
            usage={usage}
            readout={readout}
            label={label}
            now={now}
            note={note}
          />
        </PopoverContent>
      </Popover>
    </div>
  )
}

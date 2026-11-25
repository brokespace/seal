import React from 'react'
import { ChevronDown, Loader2, RefreshCw, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Toggle } from '@/components/ui/toggle'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { uiDateTimeFormat } from '@/i18n/ui-intl-formatters'
import { useTranslate } from '@/i18n/use-translate'
import { cn } from '@/lib/class-names'
import type { MachineDockerStoragePrune } from './machine-docker-storage-rows'

// Formatter caches key on option identity, so this must be a module constant.
const TIME_FORMAT: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' }

/** Re-reads Docker's inventory; says when the shown one was read. */
export function MachineDockerStorageRefresh({
  loading,
  collectedAt,
  onRefresh
}: {
  loading: boolean
  collectedAt?: number
  onRefresh: () => void
}): React.JSX.Element {
  const t = useTranslate()
  const label = t('auto.components.machines.dockerStorage.refresh', 'Refresh')
  return (
    <>
      {collectedAt === undefined ? null : (
        <span
          className="shrink-0 text-2xs text-muted-foreground tabular-nums @max-lg:hidden"
          data-machine-docker-updated={collectedAt}
        >
          {t('auto.components.machines.dockerStorage.updated', 'Updated {{time}}', {
            time: uiDateTimeFormat(TIME_FORMAT).format(collectedAt)
          })}
        </span>
      )}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={label}
            aria-busy={loading}
            onClick={onRefresh}
            data-machine-docker-refresh={loading ? 'loading' : 'idle'}
          >
            <RefreshCw className={cn(loading && 'animate-spin motion-reduce:animate-none')} />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={4}>
          {label}
        </TooltipContent>
      </Tooltip>
    </>
  )
}

export type MachineDockerStoragePruneAction = {
  target: MachineDockerStoragePrune
  label: string
  /** Nothing in the inventory for it to take. */
  disabled: boolean
}

export function MachineDockerStorageToolbar({
  filter,
  filterLabel,
  onFilter,
  reclaimableOnly,
  reclaimableOnlyLabel,
  onReclaimableOnly,
  summary,
  loading,
  collectedAt,
  onRefresh,
  prunes,
  scanning,
  onPrune,
  onCleanUp
}: {
  filter: string
  filterLabel: string
  onFilter: (filter: string) => void
  reclaimableOnly: boolean
  reclaimableOnlyLabel: string
  onReclaimableOnly: (only: boolean) => void
  summary: string
  loading: boolean
  collectedAt: number
  onRefresh: () => void
  /** The first is the button; any others go in its menu. */
  prunes: readonly MachineDockerStoragePruneAction[]
  /** The prune whose list is being read. */
  scanning: MachineDockerStoragePrune | null
  onPrune: (target: MachineDockerStoragePrune) => void
  onCleanUp: () => void
}): React.JSX.Element {
  const t = useTranslate()
  const [main, ...more] = prunes
  return (
    <div
      className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-border px-3 py-1.5"
      data-machine-docker-toolbar
    >
      <div className="flex min-w-36 flex-1 items-center gap-1.5 @lg:max-w-56">
        <Search className="size-3 shrink-0 text-muted-foreground" />
        <Input
          density="compact"
          className="min-w-0 flex-1"
          value={filter}
          placeholder={filterLabel}
          aria-label={filterLabel}
          onChange={(event) => onFilter(event.target.value)}
        />
      </div>
      <Toggle
        variant="chip"
        size="xs"
        className="shrink-0"
        pressed={reclaimableOnly}
        onPressedChange={onReclaimableOnly}
        data-machine-docker-unused-only
      >
        {reclaimableOnlyLabel}
      </Toggle>
      <span
        className="min-w-0 flex-1 truncate text-2xs text-muted-foreground"
        data-machine-docker-summary
      >
        {summary}
      </span>
      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        <MachineDockerStorageRefresh
          loading={loading}
          collectedAt={collectedAt}
          onRefresh={onRefresh}
        />
        <ButtonGroup>
          <Button
            type="button"
            variant="outline"
            size="xs"
            disabled={main.disabled || scanning !== null}
            onClick={() => onPrune(main.target)}
            data-machine-docker-prune={main.target}
          >
            {scanning === main.target ? <Loader2 className="animate-spin" /> : null}
            {main.label}
          </Button>
          {more.length > 0 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="icon-xs"
                  disabled={scanning !== null}
                  aria-label={t(
                    'auto.components.machines.dockerStorage.morePrunes',
                    'More ways to remove'
                  )}
                  data-machine-docker-prune-menu
                >
                  {more.some((prune) => prune.target === scanning) ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <ChevronDown />
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {more.map((prune) => (
                  <DropdownMenuItem
                    key={prune.target}
                    disabled={prune.disabled}
                    onSelect={() => onPrune(prune.target)}
                    data-machine-docker-prune={prune.target}
                  >
                    {prune.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </ButtonGroup>
        <Button type="button" size="xs" onClick={onCleanUp} data-machine-docker-clean-up>
          {t('auto.components.machines.dockerStorage.cleanUp', 'Clean up unused')}
        </Button>
      </div>
    </div>
  )
}

import React, { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTranslate } from '@/i18n/use-translate'
import type {
  MachineDockerInventory,
  MachineDockerStorageKind
} from '../../../../../shared/machines/machine-docker-types'
import { formatBytes } from '../model/machine-format'
import { dockerStorageItems, MACHINE_DOCKER_STORAGE_KINDS } from './machine-docker-storage-rows'

const NONE_SELECTED: ReadonlySet<string> = new Set()

type Selection = Partial<Record<MachineDockerStorageKind, ReadonlySet<string>>>

/** The ticked objects of each kind. A tick outlives a refresh only while its object is still there. */
export function useMachineDockerStorageSelection(
  inventory: MachineDockerInventory,
  kind: MachineDockerStorageKind
): { selected: ReadonlySet<string>; select: (change: (keys: Set<string>) => void) => void } {
  const [selection, setSelection] = useState<Selection>({})
  const [selectionOf, setSelectionOf] = useState(inventory)
  if (selectionOf !== inventory) {
    setSelectionOf(inventory)
    setSelection((previous) => {
      const next: Selection = {}
      for (const each of MACHINE_DOCKER_STORAGE_KINDS) {
        const ticked = previous[each]
        if (ticked && ticked.size > 0) {
          const present = new Set(dockerStorageItems(inventory, each).map((item) => item.key))
          next[each] = new Set([...ticked].filter((key) => present.has(key)))
        }
      }
      return next
    })
  }
  return {
    selected: selection[kind] ?? NONE_SELECTED,
    select: (change) =>
      setSelection((previous) => {
        const keys = new Set(previous[kind])
        change(keys)
        return { ...previous, [kind]: keys }
      })
  }
}

/** What is ticked and what removing it frees; stays in view under a long list. */
export function MachineDockerStorageSelectionBar({
  count,
  bytes,
  reading,
  disabled,
  onClear,
  onRemove
}: {
  count: number
  bytes: number
  /** The removal's list is being read from the machine. */
  reading: boolean
  disabled: boolean
  onClear: () => void
  onRemove: () => void
}): React.JSX.Element {
  const t = useTranslate()
  return (
    <div
      className="sticky bottom-0 z-10 flex items-center gap-2 border-t border-border bg-card px-3 py-1.5 text-xs"
      data-machine-docker-selection={count}
    >
      <span className="min-w-0 flex-1 truncate" role="status">
        {t('auto.components.machines.dockerStorage.selected', '{{count}} selected · {{size}}', {
          count,
          size: formatBytes(bytes)
        })}
      </span>
      <Button type="button" variant="ghost" size="xs" onClick={onClear}>
        {t('auto.components.machines.dockerStorage.clear', 'Clear')}
      </Button>
      <Button
        type="button"
        variant="destructive"
        size="xs"
        disabled={disabled}
        onClick={onRemove}
        data-machine-docker-remove-selected
      >
        {reading ? <Loader2 className="animate-spin" /> : null}
        {t('auto.components.machines.dockerStorage.removeSelected', 'Remove selected')}
      </Button>
    </div>
  )
}

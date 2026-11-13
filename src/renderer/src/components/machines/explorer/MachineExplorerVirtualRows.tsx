import React, { type RefObject } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  MACHINE_EXPLORER_ROW_HEIGHT,
  MachineExplorerRow,
  type MachineExplorerRowHandlers
} from './MachineExplorerRow'
import type { ExplorerRow } from './machine-explorer-rows'

// Listed in react-compiler-uncompiled-files: the virtualizer mutates in place, so memoized rows would go stale.
export function MachineExplorerVirtualRows({
  rows,
  scrollRef,
  selected,
  dropDir,
  handlers
}: {
  rows: readonly ExplorerRow[]
  scrollRef: RefObject<HTMLDivElement | null>
  selected: ReadonlySet<string>
  dropDir: string | null
  handlers: MachineExplorerRowHandlers
}): React.JSX.Element {
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => MACHINE_EXPLORER_ROW_HEIGHT,
    overscan: 12,
    getItemKey: (index) => rows[index]?.key ?? index
  })
  return (
    <div style={{ height: virtualizer.getTotalSize() }} className="relative w-full">
      {virtualizer.getVirtualItems().map((item) => {
        const row = rows[item.index]
        if (!row) {
          return null
        }
        return (
          <div
            key={item.key}
            className="absolute inset-x-0 top-0"
            style={{
              height: MACHINE_EXPLORER_ROW_HEIGHT,
              transform: `translateY(${item.start}px)`
            }}
          >
            <MachineExplorerRow
              row={row}
              selected={row.type === 'entry' && selected.has(row.path)}
              dropTarget={row.type === 'entry' && row.entry.isDirectoryLike && dropDir === row.path}
              handlers={handlers}
            />
          </div>
        )
      })}
    </div>
  )
}

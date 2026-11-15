import type { VirtualizedScrollAnchor } from './useVirtualizedScrollAnchor'

type VirtualScrollItem = {
  end: number
  index: number
  start: number
}

export function findVirtualizedDomScrollAnchor<TItemElement extends Element>({
  getItemElementKey,
  itemElementSelector,
  rowIndexByKey,
  scrollElement,
  topInset = 0
}: {
  getItemElementKey: (element: TItemElement) => string | null
  itemElementSelector: string
  rowIndexByKey: ReadonlyMap<string, number>
  scrollElement: Element
  // Height of a header pinned over the rows; rows behind it are not on screen.
  topInset?: number
}): NonNullable<VirtualizedScrollAnchor> | null {
  const scrollRect = scrollElement.getBoundingClientRect()
  const viewportTop = scrollRect.top + topInset
  type DomAnchorItem = { key: string; rect: DOMRect }
  const visibleItems = Array.from(scrollElement.querySelectorAll<TItemElement>(itemElementSelector))
    .map((element) => {
      const key = getItemElementKey(element)
      if (!key || !rowIndexByKey.has(key) || !element.isConnected) {
        return null
      }
      const rect = element.getBoundingClientRect()
      if (rect.height <= 0 || rect.bottom <= viewportTop || rect.top >= scrollRect.bottom) {
        return null
      }
      return { key, rect }
    })
    .filter((item): item is DomAnchorItem => item != null)
    .sort((a, b) => a.rect.top - b.rect.top)

  const [firstVisible] = visibleItems
  if (!firstVisible) {
    return null
  }

  return {
    fallbackKeys: visibleItems.slice(1).map((item) => item.key),
    key: firstVisible.key,
    // Negative when content above the rows shares the scroller and the first row starts below the viewport top.
    offset: Math.min(firstVisible.rect.height, viewportTop - firstVisible.rect.top),
    scrollTop: scrollElement.scrollTop
  }
}

export function getVirtualizedScrollAnchorForOffset<TRow>({
  getRowKey,
  rows,
  scrollTop,
  topInset = 0,
  virtualItems
}: {
  getRowKey: (row: TRow) => string
  rows: readonly TRow[]
  scrollTop: number
  topInset?: number
  virtualItems: readonly VirtualScrollItem[]
}): VirtualizedScrollAnchor {
  const viewportTop = scrollTop + topInset
  const firstVisible = virtualItems.find((item) => item.end > viewportTop)
  const row = firstVisible ? rows[firstVisible.index] : undefined
  if (!firstVisible || !row) {
    return null
  }

  return {
    fallbackKeys: virtualItems
      .slice(virtualItems.indexOf(firstVisible) + 1)
      .map((item) => rows[item.index])
      .filter((row): row is TRow => row != null)
      .map(getRowKey),
    key: getRowKey(row),
    offset: viewportTop - firstVisible.start,
    scrollTop
  }
}

// @vitest-environment happy-dom
import { expect, it } from 'vitest'
import {
  findVirtualizedDomScrollAnchor,
  getVirtualizedScrollAnchorForOffset
} from './virtualized-scroll-anchor-recording'

function rect(top: number, height: number): DOMRect {
  return new DOMRect(0, top, 280, height)
}

function mountRows(tops: Record<string, { top: number; height: number }>): HTMLElement {
  const scroller = document.createElement('div')
  scroller.getBoundingClientRect = () => rect(255, 484)
  for (const [key, box] of Object.entries(tops)) {
    const row = document.createElement('div')
    row.setAttribute('data-row', key)
    row.getBoundingClientRect = () => rect(box.top, box.height)
    scroller.append(row)
  }
  document.body.append(scroller)
  return scroller
}

it('anchors on the first row below a header pinned over the rows, not one hidden behind it', () => {
  const scrollElement = mountRows({
    behindHeader: { top: 250, height: 30 },
    pinnedGroup: { top: 287, height: 28 },
    below: { top: 315, height: 56 }
  })

  const anchor = findVirtualizedDomScrollAnchor({
    getItemElementKey: (element) => element.getAttribute('data-row'),
    itemElementSelector: '[data-row]',
    rowIndexByKey: new Map([
      ['behindHeader', 0],
      ['pinnedGroup', 1],
      ['below', 2]
    ]),
    scrollElement,
    topInset: 32
  })

  expect(anchor).toEqual({ key: 'pinnedGroup', offset: 0, fallbackKeys: ['below'], scrollTop: 0 })
  scrollElement.remove()
})

it('measures the virtual anchor offset from the bottom of the pinned header', () => {
  const anchor = getVirtualizedScrollAnchorForOffset({
    getRowKey: (row: string) => row,
    rows: ['a', 'b', 'c'],
    scrollTop: 30,
    topInset: 32,
    virtualItems: [
      { index: 0, start: 0, end: 50 },
      { index: 1, start: 50, end: 100 },
      { index: 2, start: 100, end: 150 }
    ]
  })

  expect(anchor).toEqual({ key: 'b', offset: 12, fallbackKeys: ['c'], scrollTop: 30 })
})

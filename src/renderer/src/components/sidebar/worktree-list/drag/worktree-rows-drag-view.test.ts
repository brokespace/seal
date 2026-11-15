// @vitest-environment happy-dom
import { expect, it } from 'vitest'
import { getScrollSectionContainerProps } from '../viewport/scroll-section-insets'
import { measureSidebarHeaderDragRect } from './sidebar-header-drag-geometry'
import {
  measureWorktreeRowsAutoscrollRect,
  measureWorktreeRowsViewTop
} from './worktree-rows-drag-view'

const LIST_RECT = { left: 0, right: 280, top: 100, bottom: 600 } as DOMRect

/** A list whose rows start below a 300px Active agents section and the 32px Projects header. */
function list(scrollTop: number, insets = { leading: 300, pinned: 32 }): HTMLElement {
  const element = document.createElement('div')
  const { style, ...attributes } = getScrollSectionContainerProps(insets)
  for (const [name, value] of Object.entries(style)) {
    element.style.setProperty(name, value)
  }
  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, String(value))
  }
  Object.defineProperty(element, 'scrollTop', { value: scrollTop })
  element.getBoundingClientRect = () => LIST_RECT
  return element
}

it('starts the upward autoscroll zone below the Projects header once it is pinned over the rows', () => {
  expect(measureWorktreeRowsAutoscrollRect(list(300))).toEqual({
    left: 0,
    right: 280,
    top: 132,
    bottom: 600
  })
})

it('keeps the autoscroll zone at the list top while Active agents is still on screen', () => {
  expect(measureWorktreeRowsAutoscrollRect(list(299)).top).toBe(100)
})

it('keeps a drop line clear of the Projects header, at rest and pinned', () => {
  expect(measureWorktreeRowsViewTop(list(0))).toBe(333)
  expect(measureWorktreeRowsViewTop(list(1000))).toBe(1033)
})

it('clamps a drop line to the scroll offset in a list with no section above its rows', () => {
  expect(measureWorktreeRowsViewTop(list(1000, { leading: 0, pinned: 0 }))).toBe(1000)
})

it('measures a project header and its section in scroll coordinates, below the sections sharing the list', () => {
  const container = list(0)
  const row = document.createElement('div')
  row.setAttribute('data-worktree-virtual-row', '')
  row.setAttribute('data-worktree-virtual-row-start', '250')
  const header = document.createElement('div')
  header.setAttribute('data-section-end', '382')
  row.append(header)
  container.append(row)

  const rect = measureSidebarHeaderDragRect(header, container, LIST_RECT, 'data-section-end')

  expect(rect.top).toBe(582)
  expect(rect.sectionBottom).toBe(714)
})

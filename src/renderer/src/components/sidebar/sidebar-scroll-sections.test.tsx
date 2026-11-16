// @vitest-environment happy-dom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, expect, it } from 'vitest'
import { SidebarScrollSections, SidebarScrollSectionSlots } from './sidebar-scroll-sections'

afterEach(cleanup)

function UnassignedSection(): React.JSX.Element {
  const [opened, setOpened] = useState(0)
  return (
    <button data-unassigned onClick={() => setOpened(opened + 1)}>
      {opened}
    </button>
  )
}

/** The sidebar shell: sections are owned outside the list, which renders them inside its scroll container. */
function Shell({ listKey }: { listKey: string }): React.JSX.Element {
  return (
    <SidebarScrollSections
      pinnedHeader={<span data-projects-header />}
      trailing={<UnassignedSection />}
    >
      <div key={listKey} data-scroll-container>
        <SidebarScrollSectionSlots />
        <div data-project-rows />
      </div>
    </SidebarScrollSections>
  )
}

function scrollContainers(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[data-scroll-container]')]
}

it('puts both sections in the one scroll container, the header ahead of the project rows and the trailing one after them', () => {
  render(<Shell listKey="repo" />)
  const [container, ...others] = scrollContainers()
  expect(others).toEqual([])
  const order = [
    ...container.querySelectorAll<HTMLElement>(
      '[data-unassigned], [data-projects-header], [data-project-rows]'
    )
  ].map((element) => Object.keys(element.dataset)[0])
  expect(order).toEqual(['projectsHeader', 'projectRows', 'unassigned'])
})

it('keeps a section mounted when the list replaces its scroll container', () => {
  const view = render(<Shell listKey="repo" />)
  const unassigned = document.querySelector<HTMLElement>('[data-unassigned]')!
  fireEvent.click(unassigned)
  const firstContainer = scrollContainers()[0]

  view.rerender(<Shell listKey="none" />)

  const [container] = scrollContainers()
  expect(container).not.toBe(firstContainer)
  const order = [
    ...container.querySelectorAll<HTMLElement>('[data-unassigned], [data-project-rows]')
  ].map((element) => Object.keys(element.dataset)[0])
  expect(order).toEqual(['projectRows', 'unassigned'])
  expect(container.querySelector('[data-unassigned]')).toBe(unassigned)
  expect(unassigned.textContent).toBe('1')
})

// @vitest-environment happy-dom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, expect, it } from 'vitest'
import { SidebarScrollSections, SidebarScrollSectionSlots } from './sidebar-scroll-sections'

afterEach(cleanup)

function ProjectsHeader(): React.JSX.Element {
  const [opened, setOpened] = useState(0)
  return (
    <button data-projects-header onClick={() => setOpened(opened + 1)}>
      {opened}
    </button>
  )
}

/** The sidebar shell: the header is owned outside the list, which renders it inside its scroll container. */
function Shell({ listKey }: { listKey: string }): React.JSX.Element {
  return (
    <SidebarScrollSections pinnedHeader={<ProjectsHeader />}>
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

it('keeps the header mounted, ahead of the rows, when the list replaces its scroll container', () => {
  const view = render(<Shell listKey="repo" />)
  const header = document.querySelector<HTMLElement>('[data-projects-header]')!
  fireEvent.click(header)
  const firstContainer = scrollContainers()[0]

  view.rerender(<Shell listKey="none" />)

  const [container, ...others] = scrollContainers()
  expect(others).toEqual([])
  expect(container).not.toBe(firstContainer)
  const order = [
    ...container.querySelectorAll<HTMLElement>('[data-projects-header], [data-project-rows]')
  ].map((element) => Object.keys(element.dataset)[0])
  expect(order).toEqual(['projectsHeader', 'projectRows'])
  expect(container.querySelector('[data-projects-header]')).toBe(header)
  expect(header.textContent).toBe('1')
})

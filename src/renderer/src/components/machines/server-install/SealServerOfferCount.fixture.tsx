import { defineFixture } from '../../../component-fixtures/component-fixture'
import type { MachineView } from '../../../../../shared/machines/machine-view'
import { toMachineId } from '../../../../../shared/machines/machine-types'
import { SidebarMachinesNavButton } from '@/components/sidebar/SidebarMachinesNavButton'
import { fakeMachinesApi } from '../machine-api-fixture'
import {
  SERVER_INSTALL_FIXTURE_IDS,
  SERVER_INSTALL_FIXTURE_MACHINES
} from '../machine-server-install-fixture-data'

const OFFERED = SERVER_INSTALL_FIXTURE_MACHINES.find(
  (machine) => machine.id === toMachineId(SERVER_INSTALL_FIXTURE_IDS.offer)
)

function offeredMachines(count: number): MachineView[] {
  return OFFERED
    ? Array.from({ length: count }, (_, index) => ({
        ...OFFERED,
        id: toMachineId(`offered-${index}`)
      }))
    : []
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function hoverCount(frame: HTMLElement): Promise<void> {
  await wait(100)
  frame
    .querySelector('[data-seal-server-offers]')
    ?.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType: 'mouse' }))
  await wait(900)
}

function navButtonFixture(offers: number, options: { active?: boolean; hover?: boolean } = {}) {
  return defineFixture({
    width: 260,
    store: { activeView: options.active ? 'machines' : 'terminal' },
    setup: () => {
      window.api.machines = { ...fakeMachinesApi, list: async () => offeredMachines(offers) }
    },
    render: () => (
      <div className="bg-worktree-sidebar px-2 pt-12 pb-2 text-worktree-sidebar-foreground">
        <SidebarMachinesNavButton />
      </div>
    ),
    interact: options.hover ? hoverCount : undefined
  })
}

export const oneOffer = navButtonFixture(1, { hover: true })

export const severalOffers = navButtonFixture(3, { hover: true })

export const severalOffersActive = navButtonFixture(3, { active: true })

export const noOffers = navButtonFixture(0)

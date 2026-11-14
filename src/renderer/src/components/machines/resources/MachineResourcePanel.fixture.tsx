import { defineFixture } from '../../../component-fixtures/component-fixture'
import { toRuntimeExecutionHostId } from '../../../../../shared/execution-host'
import type { MachineSummary } from '../../../../../shared/machines/machine-summaries'
import { toMachineId } from '../../../../../shared/machines/machine-types'
import { fakeMachinesApi, KESSEL, METRICS } from '../machine-api-fixture'
import { MachineResourcePanel } from './MachineResourcePanel'
import type { MachineResourceKind } from './machine-resource-requests'

const MACHINE: MachineSummary = {
  id: toMachineId(KESSEL),
  connection: 'server',
  label: 'kessel-ml',
  address: 'kessel-ml',
  status: 'online',
  statusDetail: null,
  os: 'linux',
  sshTargetId: 'kessel-ssh',
  runtimeEnvironmentId: KESSEL,
  executionHostId: toRuntimeExecutionHostId(KESSEL)
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function press(frame: HTMLElement, text: string): void {
  const buttons = Array.from(frame.querySelectorAll<HTMLElement>('button, [role="tab"]'))
  const target = buttons.find((button) => button.textContent?.trim() === text)
  // Radix tabs select on mousedown, not click.
  target?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
  target?.click()
}

function panel(kind: MachineResourceKind, then?: (frame: HTMLElement) => void) {
  return defineFixture({
    width: 920,
    setup: () => {
      window.api.machines = fakeMachinesApi
    },
    render: () => (
      <div className="flex flex-col bg-background" style={{ minHeight: 400 }}>
        <MachineResourcePanel
          machine={MACHINE}
          metrics={METRICS[toMachineId(KESSEL)] ?? null}
          kind={kind}
          onClose={() => {}}
          onReveal={() => {}}
        />
      </div>
    ),
    interact: async (frame) => {
      await wait(400)
      then?.(frame)
      await wait(400)
    }
  })
}

export const cpu = panel('cpu')

export const memory = panel('memory')

export const dockerRemoveConfirm = panel('memory', (frame) => press(frame, 'Remove'))

export const dockerPruneReview = panel('memory', (frame) =>
  frame
    .querySelector<HTMLElement>('[data-machine-cleanup-target="docker-dangling-images"] button')
    ?.click()
)

export const disk = panel('disk')

export const diskLargestFiles = panel('disk', (frame) => press(frame, 'Largest files'))

export const diskLargestFolders = panel('disk', (frame) => press(frame, 'Largest folders'))

export const diskCleanup = panel('disk', (frame) => press(frame, 'Clean up'))

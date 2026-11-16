import { afterEach, expect, it, vi } from 'vitest'
import { getLastSelectedMachineId } from '@/components/machines/model/machine-selection'
import { useAppStore } from '@/store/index'
import type { MachineView } from '../../../../../../shared/machines/machine-view'
import { offerSealServerInstall } from './seal-server-install-offer'

function sshMachine(recordId: string, sshTargetId: string): MachineView {
  return {
    id: `machine:${recordId}`,
    recordId,
    name: recordId,
    connection: 'ssh',
    ssh: {
      targetId: sshTargetId,
      address: 'brian@host:22',
      host: 'host',
      username: 'brian',
      port: 22,
      identityFile: null,
      jumpHost: null
    },
    server: null
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

it('shows the machine behind an SSH execution host and installs nothing on it', async () => {
  const installServer = vi.fn(async () => {})
  vi.stubGlobal('window', {
    api: {
      machines: {
        list: async () => [sshMachine('rec-a', 'target-a'), sshMachine('rec-b', 'target b')],
        installServer
      }
    }
  })
  useAppStore.setState({ activeView: 'terminal' })

  expect(offerSealServerInstall('ssh:target%20b')).toBe(true)

  await vi.waitFor(() => expect(useAppStore.getState().activeView).toBe('machines'))
  expect(getLastSelectedMachineId()).toBe('machine:rec-b')
  expect(installServer).not.toHaveBeenCalled()
})

it('makes no offer for a host that is not an SSH machine', () => {
  useAppStore.setState({ activeView: 'terminal' })

  expect(offerSealServerInstall('runtime:env-1')).toBe(false)
  expect(useAppStore.getState().activeView).toBe('terminal')
})

import { describe, expect, it } from 'vitest'
import type { LiveSessionHost } from '../hosts/live-session-hosts'
import { ShellIntegrationSync } from './shell-integration-hosts'

const STATUS = '@@SEAL installed=1 enabled=0 tmux=tmux_3.4 rc=/h/.zshrc\n'

function host(hostId: string, ran: string[]): LiveSessionHost {
  return {
    machine: { hostId, label: hostId, kind: 'remote' },
    run: async (script) => {
      ran.push(`${hostId}:${script.includes(': >"$dir/shell/disabled"') ? 'disable' : 'enable'}`)
      return STATUS
    }
  }
}

describe('ShellIntegrationSync', () => {
  it('applies the setting once per host, to hosts that connect later, and again after it changes', async () => {
    const ran: string[] = []
    let enabled = false
    const sync = new ShellIntegrationSync(
      () => enabled,
      () => undefined
    )
    const a = host('a', ran)
    sync.reconcile([a])
    sync.reconcile([a])
    sync.reconcile([a, host('b', ran)])
    enabled = true
    sync.settingChanged()
    sync.reconcile([a])
    await Promise.resolve()
    expect(ran).toEqual(['a:disable', 'b:disable', 'a:enable'])
  })
})

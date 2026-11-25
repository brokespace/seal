// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'
import { sampleRecapView } from './session-recap.test-fixture'
import { SessionRecapSettingsFix } from './SessionRecapSettingsFix'

const rpc = vi.hoisted(() => {
  const calls: { target: RuntimeClientTarget; method: string; params: unknown }[] = []
  return { calls }
})
vi.mock('@/runtime/rpc/calls/runtime-rpc-call', () => ({
  callRuntimeRpc: async (target: RuntimeClientTarget, method: string, params: unknown) => {
    rpc.calls.push({ target, method, params })
    if (method === 'utilityModel.providers') {
      return []
    }
    return { enabled: true, recapEnabled: method === 'sessionRecap.setEnabled', configured: true }
  }
}))

afterEach(cleanup)

it('turns recaps on at the server that keeps the recap, then asks for it again', async () => {
  const onChanged = vi.fn()
  const owner = { kind: 'environment', environmentId: 'env-kessel' } as const
  render(
    <SessionRecapSettingsFix
      view={sampleRecapView({
        recap: null,
        state: 'unavailable',
        unavailableReason: { kind: 'recaps-off' }
      })}
      host={{ owner, label: 'kessel' }}
      className=""
      onChanged={onChanged}
    />
  )
  await waitFor(() => expect(screen.getByRole('switch')).toBeEnabled())

  fireEvent.click(screen.getByRole('switch'))

  await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
  expect(rpc.calls.filter((call) => call.method === 'sessionRecap.setEnabled')).toEqual([
    { target: owner, method: 'sessionRecap.setEnabled', params: { enabled: true } }
  ])
})

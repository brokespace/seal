// @vitest-environment happy-dom
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { sampleRecapView } from './session-recap.test-fixture'
import { useSessionRecap } from './use-session-recap'

const calls = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('@/runtime/rpc/calls/runtime-rpc-call', () => ({ callRuntimeRpc: calls.rpc }))

afterEach(() => calls.rpc.mockReset())

it('says so when a Refresh gets no answer, until the next one does', async () => {
  const view = sampleRecapView()
  let refreshAnswers = false
  calls.rpc.mockImplementation((_target: unknown, method: string) =>
    method === 'sessionRecap.refresh' && !refreshAnswers
      ? Promise.reject(new Error('timed out'))
      : Promise.resolve(view)
  )
  const { result } = renderHook(() => useSessionRecap('billing', undefined))
  await waitFor(() => expect(result.current.view).toBe(view))
  expect(result.current.failed).toBeNull()

  act(() => result.current.refresh())
  await waitFor(() => expect(result.current.failed).toBe('refresh'))
  expect(result.current.refreshing).toBe(false)

  refreshAnswers = true
  act(() => result.current.refresh())
  expect(result.current.failed).toBeNull()
  await waitFor(() => expect(result.current.refreshing).toBe(false))
  expect(result.current.failed).toBeNull()
})

it('takes back a tick the host never saved, and says it was not saved', async () => {
  const view = sampleRecapView({ marks: {} })
  calls.rpc.mockImplementation((_target: unknown, method: string) =>
    method === 'sessionRecap.mark' ? Promise.reject(new Error('offline')) : Promise.resolve(view)
  )
  const { result } = renderHook(() => useSessionRecap('billing', undefined))
  await waitFor(() => expect(result.current.view).toBe(view))

  act(() => result.current.mark('a8', 'done'))
  expect(result.current.view?.marks).toEqual({ a8: 'done' })

  await waitFor(() => expect(result.current.failed).toBe('mark'))
  await waitFor(() => expect(result.current.view?.marks).toEqual({}))
})

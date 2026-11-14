// @vitest-environment happy-dom

import { act, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { SealMcpApprovalRequest } from '../../../../shared/seal-mcp/seal-mcp-types'

const stream = vi.hoisted(() => ({ emit: (_frame: unknown): void => {} }))
vi.mock('@/runtime/rpc/subscriptions/runtime-rpc-subscribe', () => ({
  subscribeRuntimeRpc: (
    _target: unknown,
    _method: string,
    _params: unknown,
    handlers: { onEvent: (frame: unknown) => void }
  ) => {
    stream.emit = handlers.onEvent
    return Promise.resolve({ unsubscribe: () => {} })
  }
}))
vi.mock('@/runtime/rpc/calls/runtime-rpc-call', () => ({
  callRuntimeRpc: () => Promise.resolve({})
}))

const { useSealMcpApprovals } = await import('./use-seal-mcp-approvals')

afterEach(() => {
  vi.useRealTimers()
})

const START = Date.UTC(2026, 10, 14, 12, 0, 0)

function request(id: string, expiresAt: number): SealMcpApprovalRequest {
  return {
    id,
    clientId: 'c1',
    clientName: 'Claude Code',
    transport: 'stdio',
    tool: 'run_command',
    machine: null,
    summary: '{"command":"ls"}',
    reason: 'This runs a shell command.',
    requestedAt: START,
    expiresAt
  }
}

function waitingIds(result: { current: ReturnType<typeof useSealMcpApprovals> }): string[] {
  return result.current.approvals.map((approval) => approval.id)
}

it('drops a waiting call when the server settles it and keeps the others', () => {
  vi.useFakeTimers({ now: START })
  const { result } = renderHook(() => useSealMcpApprovals({ kind: 'local' }))
  act(() => {
    stream.emit({
      type: 'ready',
      subscriptionId: 'sub-1',
      approvals: [request('first', START + 120_000)]
    })
    stream.emit({
      type: 'event',
      event: { type: 'approval-requested', request: request('second', START + 120_000) }
    })
  })
  expect(waitingIds(result)).toEqual(['first', 'second'])

  act(() => {
    stream.emit({ type: 'event', event: { type: 'approval-settled', id: 'first' } })
  })
  expect(waitingIds(result)).toEqual(['second'])
})

it('drops a waiting call at its deadline even if no settled event arrives', () => {
  vi.useFakeTimers({ now: START })
  const { result } = renderHook(() => useSealMcpApprovals({ kind: 'local' }))
  act(() => {
    stream.emit({
      type: 'ready',
      subscriptionId: 'sub-1',
      approvals: [request('short', START + 30_000), request('long', START + 120_000)]
    })
  })
  expect(waitingIds(result)).toEqual(['short', 'long'])

  act(() => {
    vi.advanceTimersByTime(30_000)
  })
  expect(waitingIds(result)).toEqual(['long'])
})

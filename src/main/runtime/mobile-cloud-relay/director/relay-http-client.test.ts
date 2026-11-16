import { describe, expect, it, vi } from 'vitest'
import { RelayAssignRateGate } from './relay-assign-rate-gate'
import { requestRelayAssignment } from './relay-http-client'

type AssignInput = Parameters<typeof requestRelayAssignment>[0]

function assignSuccessResponse(cellUrl = 'https://relay.example'): Response {
  return Response.json({ v: 1, cellUrl, assignmentEpoch: 4, lease: 'lease-jwt' })
}

describe('relay assignment cell pin', () => {
  const assign = (cellUrl: string, input: Partial<AssignInput> = {}): Promise<unknown> =>
    requestRelayAssignment({
      directorUrl: 'https://relay.example',
      relayToken: 'scoped-token',
      relayHostId: 'AbCdEf0123_-xyZ9',
      allowedCellOrigins: [],
      assignRateGate: new RelayAssignRateGate(),
      fetch: vi.fn<typeof globalThis.fetch>().mockResolvedValue(assignSuccessResponse(cellUrl)),
      ...input
    })

  it('follows the director to itself', async () => {
    await expect(assign('https://relay.example')).resolves.toEqual({
      v: 1,
      cellUrl: 'https://relay.example',
      assignmentEpoch: 4,
      lease: 'lease-jwt'
    })
  })

  it.each([
    'https://cell.attacker.example',
    'https://relay.example.attacker.example',
    'https://relay.example:8443',
    'http://127.0.0.1:8787'
  ])('fails an assignment to %s as a bad director answer', async (cellUrl) => {
    await expect(assign(cellUrl)).rejects.toMatchObject({
      message: 'relay_assignment_failed_502',
      statusCode: 502
    })
  })

  it('follows the director to an explicitly allowed cell', async () => {
    await expect(
      assign('https://relay-c1.example', { allowedCellOrigins: ['https://relay-c1.example'] })
    ).resolves.toMatchObject({ cellUrl: 'https://relay-c1.example' })
  })

  it('keeps a loopback development director on its own origin', async () => {
    await expect(
      assign('http://127.0.0.1:8787', { directorUrl: 'http://127.0.0.1:8787' })
    ).resolves.toMatchObject({ cellUrl: 'http://127.0.0.1:8787' })
  })
})

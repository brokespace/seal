import { describe, expect, it, vi } from 'vitest'
import type { OrcaRuntimeService } from '../../../orca-runtime'
import { eraseRpcMethods, isStreamingMethod, type RpcContext } from '../../core'

const pushed = vi.hoisted(() => {
  const calls: { machines: string[]; accounts?: string[] }[] = []
  return { calls }
})

vi.mock('../../../../seal-accounts/seal-account-manager', () => ({
  requireSealAccountManager: () => ({})
}))
vi.mock('../../../../seal-accounts/seal-fleet-sync', () => ({
  exportSealCredential: vi.fn(),
  syncSealFleet: async (_manager: unknown, machines: string[], accounts?: string[]) => {
    pushed.calls.push({ machines, accounts })
    return machines.map((environmentId) => ({
      environmentId,
      ok: true,
      error: null,
      credentials: []
    }))
  }
}))

const { SEAL_ACCOUNT_METHODS } = await import('./seal-accounts')

async function syncFleet(context: Pick<RpcContext, 'caller' | 'clientKind' | 'pairedDeviceId'>) {
  const found = eraseRpcMethods(SEAL_ACCOUNT_METHODS).find(
    (candidate) => candidate.name === 'seal.accounts.syncFleet'
  )
  if (!found || isStreamingMethod(found)) {
    throw new Error('seal.accounts.syncFleet must be a request method')
  }
  const params = { environmentIds: ['build-box'], accounts: ['claude:brian@acme.dev'] }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: syncFleet never reads the runtime.
  const runtime = {} as OrcaRuntimeService
  return found.handler(found.params ? found.params.parse(params) : params, { runtime, ...context })
}

describe('seal.accounts.syncFleet', () => {
  it('pushes logins for the desktop window and the local CLI', async () => {
    pushed.calls.length = 0
    // The desktop window reaches the runtime as a 'runtime' client with the desktop identity.
    await expect(
      syncFleet({ clientKind: 'runtime', caller: { kind: 'desktop' } })
    ).resolves.toEqual({
      results: [{ environmentId: 'build-box', ok: true, error: null, credentials: [] }]
    })
    await syncFleet({ caller: { kind: 'local-cli' } })
    expect(pushed.calls).toEqual([
      { machines: ['build-box'], accounts: ['claude:brian@acme.dev'] },
      { machines: ['build-box'], accounts: ['claude:brian@acme.dev'] }
    ])
  })

  it('refuses a paired device, so a login never leaves this desktop on a remote request', async () => {
    pushed.calls.length = 0
    await expect(
      syncFleet({ clientKind: 'runtime', caller: { kind: 'paired-device', deviceId: 'laptop' } })
    ).rejects.toThrow('Push accounts from the Seal desktop app or its CLI.')
    await expect(syncFleet({ clientKind: 'mobile', pairedDeviceId: 'phone' })).rejects.toThrow(
      'Push accounts from the Seal desktop app or its CLI.'
    )
    expect(pushed.calls).toEqual([])
  })
})

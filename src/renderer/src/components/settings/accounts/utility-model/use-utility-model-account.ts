import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { callRuntimeRpc } from '@/runtime/rpc/calls/runtime-rpc-call'
import { RuntimeRpcCallError } from '@/runtime/rpc/calls/runtime-rpc-result'
import type { RuntimeClientTarget } from '../../../../../../shared/runtime-client-target'
import type {
  UtilityModelProviderId,
  UtilityModelProviderStatus,
  UtilityModelTestResult
} from '../../../../../../shared/utility-model/utility-model-types'
import type { UsageCredentialAccess } from '../usage/usage-credential-host'

// A test waits on the provider, behind the host's own request limit.
const HOST_TIMEOUT_MS = 30_000

export type UtilityModelAccountModel = {
  status: UtilityModelProviderStatus | null
  access: UsageCredentialAccess
  busy: boolean
  testing: boolean
  testResult: UtilityModelTestResult | null
  /** Runs a host method that changes the account; resolves true once the host saved. */
  change: (method: string, params?: unknown) => Promise<boolean>
  test: () => Promise<void>
}

// React Compiler cannot lower a try/finally written inside the hook.
async function settling<T>(run: () => Promise<T>, settle: () => void): Promise<T> {
  try {
    return await run()
  } finally {
    settle()
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** One utility model provider's account on one host. Remount (key by owner) to point it at another. */
export function useUtilityModelAccount(
  owner: RuntimeClientTarget,
  provider: UtilityModelProviderId,
  copy: { saveFailed: string; testFailed: string }
): UtilityModelAccountModel {
  const [status, setStatus] = useState<UtilityModelProviderStatus | null>(null)
  const [access, setAccess] = useState<UsageCredentialAccess>('checking')
  const [busy, setBusy] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<UtilityModelTestResult | null>(null)
  const ownerRef = useRef(owner)
  const mounted = useRef(true)

  const call = useCallback(
    <T>(method: string, params?: unknown): Promise<T> =>
      callRuntimeRpc<T>(ownerRef.current, method, params, { timeoutMs: HOST_TIMEOUT_MS }),
    []
  )

  const read = useCallback(async (): Promise<void> => {
    const [next] = await call<UtilityModelProviderStatus[]>('utilityModel.providers', { provider })
    if (mounted.current && next) {
      setStatus(next)
      setAccess('ready')
    }
  }, [call, provider])

  useEffect(() => {
    mounted.current = true
    void read().catch((error: unknown) => {
      if (mounted.current) {
        // A host from before provider choice has no such method; nothing is saved there.
        const outdated = error instanceof RuntimeRpcCallError && error.code === 'method_not_found'
        setAccess(outdated ? 'outdated' : 'unreachable')
      }
    })
    return () => {
      mounted.current = false
    }
  }, [read])

  return {
    status,
    access,
    busy,
    testing,
    testResult,
    change: async (method, params) => {
      if (busy) {
        return false
      }
      setBusy(true)
      return settling(
        async () => {
          try {
            await call(method, params)
            if (mounted.current) {
              setTestResult(null)
            }
            await read()
            return true
          } catch (error) {
            toast.error(copy.saveFailed, { description: describe(error) })
            return false
          }
        },
        () => mounted.current && setBusy(false)
      )
    },
    test: async () => {
      setTesting(true)
      await settling(
        async () => {
          try {
            const { result, providerStatus } = await call<{
              result: UtilityModelTestResult
              providerStatus: UtilityModelProviderStatus
            }>('utilityModel.test', { provider })
            if (mounted.current) {
              setTestResult(result)
              setStatus(providerStatus)
            }
          } catch (error) {
            toast.error(copy.testFailed, { description: describe(error) })
          }
        },
        () => mounted.current && setTesting(false)
      )
    }
  }
}

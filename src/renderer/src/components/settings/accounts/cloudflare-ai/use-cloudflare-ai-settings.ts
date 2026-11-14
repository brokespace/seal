import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useTranslate } from '@/i18n/use-translate'
import { callRuntimeRpc } from '@/runtime/rpc/calls/runtime-rpc-call'
import { RuntimeRpcCallError } from '@/runtime/rpc/calls/runtime-rpc-result'
import type { RuntimeClientTarget } from '../../../../../../shared/runtime-client-target'
import type { SessionSummariesStatus } from '../../../../../../shared/session-summaries/session-summary-contracts'
import type {
  UtilityModelCatalogEntry,
  UtilityModelCatalogResult,
  UtilityModelFailure,
  UtilityModelStatus,
  UtilityModelTestResult
} from '../../../../../../shared/utility-model/utility-model-types'
import type { UsageCredentialAccess } from '../usage/usage-credential-host'

// A test or model list waits on Cloudflare, behind the host's own 20 s request limit.
const HOST_TIMEOUT_MS = 30_000

export type CloudflareAiFields = {
  accountId?: string
  apiToken?: string
  model?: string
  fallbackModel?: string
}

export type CloudflareAiSettingsModel = {
  status: UtilityModelStatus | null
  summaries: SessionSummariesStatus | null
  access: UsageCredentialAccess
  busy: boolean
  models: UtilityModelCatalogEntry[]
  modelsFailure: UtilityModelFailure | null
  testing: boolean
  testResult: UtilityModelTestResult | null
  /** Resolves true once the host saved the fields. */
  save: (fields: CloudflareAiFields) => Promise<boolean>
  forget: () => Promise<void>
  test: () => Promise<void>
  setSummariesEnabled: (enabled: boolean) => Promise<void>
}

/** The utility model on one host. Remount (key by owner) to point it at another. */
export function useCloudflareAiSettings(owner: RuntimeClientTarget): CloudflareAiSettingsModel {
  const t = useTranslate()
  const [status, setStatus] = useState<UtilityModelStatus | null>(null)
  const [summaries, setSummaries] = useState<SessionSummariesStatus | null>(null)
  const [access, setAccess] = useState<UsageCredentialAccess>('checking')
  const [busy, setBusy] = useState(false)
  const [models, setModels] = useState<UtilityModelCatalogEntry[]>([])
  const [modelsFailure, setModelsFailure] = useState<UtilityModelFailure | null>(null)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<UtilityModelTestResult | null>(null)
  const ownerRef = useRef(owner)
  const mounted = useRef(true)

  const call = useCallback(
    <T>(method: string, params?: unknown): Promise<T> =>
      callRuntimeRpc<T>(ownerRef.current, method, params, { timeoutMs: HOST_TIMEOUT_MS }),
    []
  )

  const readSummaries = useCallback(async (): Promise<void> => {
    const next = await call<SessionSummariesStatus>('sessionSummaries.status').catch(() => null)
    if (mounted.current) {
      setSummaries(next)
    }
  }, [call])

  useEffect(() => {
    mounted.current = true
    void call<UtilityModelStatus>('utilityModel.status').then(
      (next) => {
        if (mounted.current) {
          setStatus(next)
          setAccess('ready')
        }
      },
      (error: unknown) => {
        if (mounted.current) {
          // A host from before utility models has no such method; nothing is saved there.
          const outdated = error instanceof RuntimeRpcCallError && error.code === 'method_not_found'
          setAccess(outdated ? 'outdated' : 'unreachable')
        }
      }
    )
    void readSummaries()
    return () => {
      mounted.current = false
    }
  }, [call, readSummaries])

  const configured = status?.configured === true
  const account = status?.accountHint ?? null
  useEffect(() => {
    if (!configured) {
      setModels([])
      setModelsFailure(null)
      return
    }
    let stale = false
    void call<UtilityModelCatalogResult>('utilityModel.listModels').then(
      (result) => {
        if (!stale) {
          setModels(result.ok ? result.models : [])
          setModelsFailure(result.ok ? null : result.failure)
        }
      },
      () => {}
    )
    return () => {
      stale = true
    }
  }, [call, configured, account])

  const mutate = async (run: () => Promise<UtilityModelStatus>): Promise<boolean> => {
    if (busy) {
      return false
    }
    setBusy(true)
    try {
      const next = await run()
      if (mounted.current) {
        setStatus(next)
        setTestResult(null)
      }
      await readSummaries()
      return true
    } catch (error) {
      toast.error(t('seal.cloudflareAi.saveFailed', 'Cloudflare AI settings were not saved.'), {
        description: error instanceof Error ? error.message : String(error)
      })
      return false
    } finally {
      if (mounted.current) {
        setBusy(false)
      }
    }
  }

  return {
    status,
    summaries,
    access,
    busy,
    models,
    modelsFailure,
    testing,
    testResult,
    save: (fields) => mutate(() => call<UtilityModelStatus>('utilityModel.setCloudflare', fields)),
    forget: async () => {
      await mutate(() => call<UtilityModelStatus>('utilityModel.clearCloudflare'))
    },
    test: async () => {
      setTesting(true)
      try {
        const { result, status: next } = await call<{
          result: UtilityModelTestResult
          status: UtilityModelStatus
        }>('utilityModel.test')
        if (mounted.current) {
          setTestResult(result)
          setStatus(next)
        }
        await readSummaries()
      } catch (error) {
        toast.error(t('seal.cloudflareAi.testFailed', 'Could not run the Cloudflare AI test.'), {
          description: error instanceof Error ? error.message : String(error)
        })
      } finally {
        if (mounted.current) {
          setTesting(false)
        }
      }
    },
    setSummariesEnabled: async (enabled) => {
      try {
        const next = await call<SessionSummariesStatus>('sessionSummaries.setEnabled', { enabled })
        if (mounted.current) {
          setSummaries(next)
        }
      } catch (error) {
        toast.error(
          t('seal.sessionSummaries.toggleFailed', 'Could not change session summaries.'),
          {
            description: error instanceof Error ? error.message : String(error)
          }
        )
      }
    }
  }
}

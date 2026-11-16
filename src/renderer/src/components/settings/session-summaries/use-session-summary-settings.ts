import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useTranslate } from '@/i18n/use-translate'
import { callRuntimeRpc } from '@/runtime/rpc/calls/runtime-rpc-call'
import { RuntimeRpcCallError } from '@/runtime/rpc/calls/runtime-rpc-result'
import type { RuntimeClientTarget } from '../../../../../shared/remote-runtime/host-catalog/runtime-client-target'
import type { SessionSummariesStatus } from '../../../../../shared/session-summaries/session-summary-contracts'
import {
  normalizeSessionSummaryModels,
  utilityModelChoiceFor,
  type SessionSummaryModels,
  type UtilityModelTask
} from '../../../../../shared/utility-model/utility-model-selection'
import type {
  UtilityModelCatalogEntry,
  UtilityModelCatalogResult,
  UtilityModelFailure,
  UtilityModelProviderId,
  UtilityModelProviderStatus,
  UtilityModelTestResult
} from '../../../../../shared/utility-model/utility-model-types'
import type { UsageCredentialAccess } from '../accounts/usage/usage-credential-host'

// A test or a model list waits on the provider; an agent CLI takes the longest to answer.
const HOST_TIMEOUT_MS = 90_000

export type UtilityModelCatalog = {
  loading: boolean
  models: UtilityModelCatalogEntry[]
  failure: UtilityModelFailure | null
}

export type SessionSummarySettingsModel = {
  status: SessionSummariesStatus | null
  /** What summaries and recaps run on; Cloudflare Workers AI on a host that predates the choice. */
  models: SessionSummaryModels
  providers: UtilityModelProviderStatus[]
  /** `outdated`: the host cannot run anything but Cloudflare Workers AI yet. */
  access: UsageCredentialAccess
  saving: boolean
  catalogs: Partial<Record<UtilityModelProviderId, UtilityModelCatalog>>
  testing: UtilityModelTask | null
  testResults: Partial<Record<UtilityModelTask, UtilityModelTestResult>>
  loadModels: (provider: UtilityModelProviderId) => void
  setSummariesEnabled: (enabled: boolean) => Promise<void>
  setRecapEnabled: (enabled: boolean) => Promise<void>
  setModels: (models: SessionSummaryModels) => Promise<void>
  test: (task: UtilityModelTask) => Promise<void>
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

/** Session summaries and recaps on one host. Remount (key by owner) to point it at another. */
export function useSessionSummarySettings(owner: RuntimeClientTarget): SessionSummarySettingsModel {
  const t = useTranslate()
  const [status, setStatus] = useState<SessionSummariesStatus | null>(null)
  const [providers, setProviders] = useState<UtilityModelProviderStatus[]>([])
  const [access, setAccess] = useState<UsageCredentialAccess>('checking')
  const [saving, setSaving] = useState(false)
  const [catalogs, setCatalogs] = useState<SessionSummarySettingsModel['catalogs']>({})
  const [testing, setTesting] = useState<UtilityModelTask | null>(null)
  const [testResults, setTestResults] = useState<SessionSummarySettingsModel['testResults']>({})
  const ownerRef = useRef(owner)
  const mounted = useRef(true)
  const requested = useRef(new Set<UtilityModelProviderId>())

  const call = useCallback(
    <T>(method: string, params?: unknown): Promise<T> =>
      callRuntimeRpc<T>(ownerRef.current, method, params, { timeoutMs: HOST_TIMEOUT_MS }),
    []
  )

  const readProviders = useCallback(async (): Promise<void> => {
    const next = await call<UtilityModelProviderStatus[]>('utilityModel.providers')
    if (mounted.current) {
      setProviders(next)
      setAccess('ready')
    }
  }, [call])

  useEffect(() => {
    mounted.current = true
    void call<SessionSummariesStatus>('sessionSummaries.status').then(
      (next) => mounted.current && setStatus(next),
      () => {}
    )
    void readProviders().catch((error: unknown) => {
      if (mounted.current) {
        const outdated = error instanceof RuntimeRpcCallError && error.code === 'method_not_found'
        setAccess(outdated ? 'outdated' : 'unreachable')
      }
    })
    return () => {
      mounted.current = false
    }
  }, [call, readProviders])

  const change = async (method: string, params: unknown, failed: string): Promise<void> => {
    setSaving(true)
    await settling(
      async () => {
        try {
          const next = await call<SessionSummariesStatus>(method, params)
          if (mounted.current) {
            setStatus(next)
          }
        } catch (error) {
          toast.error(failed, { description: describe(error) })
        }
      },
      () => mounted.current && setSaving(false)
    )
  }

  const models = normalizeSessionSummaryModels(status?.models)

  return {
    status,
    models,
    providers,
    access,
    saving,
    catalogs,
    testing,
    testResults,
    loadModels: (provider) => {
      if (requested.current.has(provider)) {
        return
      }
      requested.current.add(provider)
      setCatalogs((current) => ({
        ...current,
        [provider]: { loading: true, models: [], failure: null }
      }))
      void call<UtilityModelCatalogResult>('utilityModel.listModels', { provider }).then(
        (result) => {
          if (mounted.current) {
            setCatalogs((current) => ({
              ...current,
              [provider]: {
                loading: false,
                models: result.ok ? result.models : [],
                failure: result.ok ? null : result.failure
              }
            }))
          }
        },
        () => {
          // Unreachable host: the next open asks again.
          requested.current.delete(provider)
          if (mounted.current) {
            setCatalogs((current) => ({ ...current, [provider]: undefined }))
          }
        }
      )
    },
    setSummariesEnabled: (enabled) =>
      change(
        'sessionSummaries.setEnabled',
        { enabled },
        t('seal.sessionSummaries.toggleFailed', 'Could not change session summaries.')
      ),
    setRecapEnabled: (enabled) =>
      change(
        'sessionRecap.setEnabled',
        { enabled },
        t('seal.sessionRecap.toggleFailed', 'Could not change session recaps.')
      ),
    setModels: async (next) => {
      setTestResults({})
      await change(
        'sessionSummaries.setModels',
        next,
        t('seal.summaryModels.saveFailed', 'The provider and model were not saved.')
      )
    },
    test: async (task) => {
      const { provider, model, fallbackModel } = utilityModelChoiceFor(models, task)
      setTesting(task)
      await settling(
        async () => {
          try {
            const { result } = await call<{ result: UtilityModelTestResult }>('utilityModel.test', {
              provider,
              model,
              fallbackModel
            })
            if (mounted.current) {
              setTestResults((current) => ({ ...current, [task]: result }))
            }
            await readProviders()
          } catch (error) {
            toast.error(t('seal.summaryModels.testFailed', 'Could not run the test.'), {
              description: describe(error)
            })
          }
        },
        () => mounted.current && setTesting(null)
      )
    }
  }
}

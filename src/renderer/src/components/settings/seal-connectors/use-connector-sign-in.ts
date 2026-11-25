import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useTranslate } from '@/i18n/use-translate'
import { openAppHttpLink } from '@/lib/browser/navigation/app-http-link-open'
import type {
  SealConnectorsSignInResult,
  SealConnectorsSignInStart
} from '../../../../../shared/rpc-contract/seal-connectors-params'
import { connectorsCall } from './use-seal-connectors'

const START_TIMEOUT_MS = 60_000
const WAIT_TIMEOUT_MS = 15 * 60_000

export type ConnectorSignInPhase = 'idle' | 'starting' | 'waiting' | 'failed'

export type ConnectorSignInController = {
  phase: ConnectorSignInPhase
  url: string | null
  error: string | null
  /** Reconnects `signInId`, or adds another sign-in when null. */
  start: (signInId: string | null) => void
  cancel: () => void
  /** Resolves to a refusal to show, or null once accepted. */
  submitRedirect: (url: string) => Promise<string | null>
  dismiss: () => void
}

function errorText(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught)
}

/** One Connect: Seal runs Claude Code's sign-in, the approval page opens in the browser, the sign-in lands in the list. */
export function useConnectorSignIn(
  connector: { id: string; title: string },
  onDone: () => void
): ConnectorSignInController {
  const t = useTranslate()
  const [phase, setPhase] = useState<ConnectorSignInPhase>('idle')
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const attempt = useRef<string | null>(null)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const finish = useCallback(
    (result: SealConnectorsSignInResult) => {
      attempt.current = null
      if (!alive.current) {
        return
      }
      if (result.ok) {
        toast.success(
          t('seal.connectors.signIn.done', '{{title}} is connected.', { title: connector.title }),
          result.message ? { description: result.message } : undefined
        )
        setPhase('idle')
        setUrl(null)
        setError(null)
      } else {
        const message =
          result.message ?? t('seal.connectors.signIn.failed', 'The sign-in did not finish.')
        toast.error(
          t('seal.connectors.signIn.failedTitle', 'Could not connect {{title}}', {
            title: connector.title
          }),
          { description: message }
        )
        setError(message)
        setPhase('failed')
      }
      onDone()
    },
    [connector.title, onDone, t]
  )

  const start = useCallback(
    (signInId: string | null) => {
      setPhase('starting')
      setError(null)
      setUrl(null)
      void (async () => {
        try {
          const started = await connectorsCall<SealConnectorsSignInStart>(
            'seal.connectors.startSignIn',
            { connectorId: connector.id, signInId },
            { timeoutMs: START_TIMEOUT_MS }
          )
          if (started.kind === 'finished') {
            finish(started.result)
            return
          }
          attempt.current = started.attemptId
          setUrl(started.url)
          setPhase('waiting')
          openAppHttpLink(started.url, { destination: 'system' })
          const result = await connectorsCall<SealConnectorsSignInResult>(
            'seal.connectors.waitSignIn',
            { attemptId: started.attemptId },
            { timeoutMs: WAIT_TIMEOUT_MS }
          )
          if (attempt.current === started.attemptId) {
            finish(result)
          }
        } catch (caught) {
          if (attempt.current === null && !alive.current) {
            return
          }
          attempt.current = null
          setError(errorText(caught))
          setPhase('failed')
        }
      })()
    },
    [connector.id, finish]
  )

  const cancel = useCallback(() => {
    const attemptId = attempt.current
    attempt.current = null
    setPhase('idle')
    setUrl(null)
    if (attemptId) {
      void connectorsCall('seal.connectors.cancelSignIn', { attemptId }).catch(() => undefined)
    }
  }, [])

  const submitRedirect = useCallback(
    async (pasted: string): Promise<string | null> => {
      const attemptId = attempt.current
      if (!attemptId) {
        return t('seal.connectors.signIn.noAttempt', 'This sign-in is no longer running.')
      }
      try {
        return await connectorsCall<string | null>('seal.connectors.submitRedirect', {
          attemptId,
          url: pasted
        })
      } catch (caught) {
        return errorText(caught)
      }
    },
    [t]
  )

  const dismiss = useCallback(() => {
    setPhase('idle')
    setError(null)
    setUrl(null)
  }, [])

  return { phase, url, error, start, cancel, submitRedirect, dismiss }
}

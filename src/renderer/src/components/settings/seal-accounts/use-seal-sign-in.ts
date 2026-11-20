import { useCallback, useEffect, useRef, useState } from 'react'
import { callRuntimeRpc } from '@/runtime/rpc/calls/runtime-rpc-call'
import {
  HOST_ACCOUNT_SIGN_IN_SETTLED_PHASES,
  type HostAccountSignInStatus
} from '../../../../../shared/host-account-sign-in-types'
import type { RuntimeClientTarget } from '../../../../../shared/runtime-client-target'
import type {
  SealSignInOutcome,
  SealSignInRequest
} from '../../../../../shared/seal-accounts/seal-sign-in'

// Longer than the host's 20 s long poll, so a quiet sign-in answers before the call gives up.
const WAIT_TIMEOUT_MS = 40_000

export type SealSignInController = {
  /** The running or last sign-in; null before one starts and after `reset`. */
  status: HostAccountSignInStatus | null
  /** Why the sign-in could not start or its host stopped answering. */
  error: string | null
  start: (request: SealSignInRequest) => void
  /** Resolves with the host's refusal, or null once the code was accepted for checking. */
  submitCode: (code: string) => Promise<string | null>
  cancel: () => void
  reset: () => void
}

function errorText(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught)
}

function settled(status: HostAccountSignInStatus): boolean {
  return HOST_ACCOUNT_SIGN_IN_SETTLED_PHASES.has(status.phase)
}

/** Drives one account sign-in on `target`; leaving the page cancels it so no CLI is left running. */
export function useSealSignIn(
  target: RuntimeClientTarget,
  onSignedIn: (outcome: SealSignInOutcome) => void
): SealSignInController {
  const [status, setStatus] = useState<HostAccountSignInStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Each start gets a token; answers from a superseded sign-in are dropped.
  const run = useRef(0)
  const flowId = useRef<string | null>(null)
  const signedIn = useRef(onSignedIn)
  useEffect(() => {
    signedIn.current = onSignedIn
  }, [onSignedIn])

  const stop = useCallback((): void => {
    const running = flowId.current
    flowId.current = null
    run.current += 1
    if (running) {
      void callRuntimeRpc(target, 'seal.accounts.signInCancel', { flowId: running }).catch(() => {})
    }
  }, [target])

  useEffect(() => stop, [stop])

  const start = useCallback(
    (request: SealSignInRequest): void => {
      stop()
      const token = run.current
      const current = (): boolean => run.current === token
      setError(null)
      setStatus(null)
      void (async () => {
        try {
          let next = await callRuntimeRpc<HostAccountSignInStatus>(
            target,
            'seal.accounts.signInStart',
            request,
            { timeoutMs: 30_000 }
          )
          if (!current()) {
            void callRuntimeRpc(target, 'seal.accounts.signInCancel', {
              flowId: next.flowId
            }).catch(() => {})
            return
          }
          flowId.current = next.flowId
          setStatus(next)
          while (!settled(next)) {
            next = await callRuntimeRpc<HostAccountSignInStatus>(
              target,
              'seal.accounts.signInWait',
              { flowId: next.flowId, afterRevision: next.revision },
              { timeoutMs: WAIT_TIMEOUT_MS }
            )
            if (!current()) {
              return
            }
            setStatus(next)
          }
          flowId.current = null
          if (next.phase === 'signedIn' && next.seal) {
            signedIn.current(next.seal)
          }
        } catch (caught) {
          if (current()) {
            flowId.current = null
            setError(errorText(caught))
          }
        }
      })()
    },
    [stop, target]
  )

  const submitCode = useCallback(
    async (code: string): Promise<string | null> => {
      const running = flowId.current
      if (!running) {
        return null
      }
      try {
        const next = await callRuntimeRpc<HostAccountSignInStatus>(
          target,
          'seal.accounts.signInSubmitCode',
          { flowId: running, code }
        )
        if (flowId.current === running) {
          setStatus(next)
        }
        return null
      } catch (caught) {
        return errorText(caught)
      }
    },
    [target]
  )

  const cancel = useCallback((): void => {
    stop()
    setStatus((current) =>
      current && !settled(current) ? { ...current, phase: 'cancelled', prompt: undefined } : current
    )
  }, [stop])

  const reset = useCallback((): void => {
    stop()
    setStatus(null)
    setError(null)
  }, [stop])

  return { status, error, start, submitCode, cancel, reset }
}

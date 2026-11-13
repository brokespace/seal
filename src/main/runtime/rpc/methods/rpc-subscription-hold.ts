import type { RpcContext } from '../core'

let watchSeq = 0

/** Runs `start` until the caller aborts or unwatches; `start` returns its own teardown. */
export async function holdSubscription(
  prefix: string,
  { runtime, connectionId, signal }: RpcContext,
  emit: (result: unknown) => void,
  start: (subscriptionId: string) => () => void
): Promise<void> {
  if (signal?.aborted) {
    return
  }
  const stopped = Promise.withResolvers<void>()
  const subscriptionId = `${prefix}-${connectionId ?? 'inproc'}-${++watchSeq}`
  const release = (): void => runtime.cleanupSubscription(subscriptionId)
  const teardown = start(subscriptionId)
  runtime.registerSubscriptionCleanup(
    subscriptionId,
    () => {
      signal?.removeEventListener('abort', release)
      teardown()
      stopped.resolve()
    },
    connectionId
  )
  try {
    signal?.addEventListener('abort', release, { once: true })
    await stopped.promise
    emit({ type: 'end' })
  } finally {
    release()
  }
}

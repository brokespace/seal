import { useCallback, useEffect, useEffectEvent, useState } from 'react'

export type ProjectOverviewLoad<T> =
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'error'; error: string }

type Settled<T> = { key: string; value: ProjectOverviewLoad<T> }

/**
 * One read for a card. `key` names what is being read: a new key starts over, and the answer to an
 * old key is dropped. Null waits (the project's machine is not known yet).
 */
export function useProjectOverviewLoad<T>(
  key: string | null,
  load: (signal: AbortSignal) => Promise<T>
): ProjectOverviewLoad<T> & { reload: () => void } {
  const [settled, setSettled] = useState<Settled<T> | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const reload = useCallback(() => setReloadToken((token) => token + 1), [])
  // `load` is a fresh closure each render; `key` says when its inputs changed.
  const run = useEffectEvent(load)

  useEffect(() => {
    if (key === null) {
      return
    }
    const controller = new AbortController()
    run(controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) {
          setSettled({ key, value: { status: 'ready', data } })
        }
      },
      (error: unknown) => {
        if (!controller.signal.aborted) {
          setSettled({
            key,
            value: {
              status: 'error',
              error: error instanceof Error ? error.message : String(error)
            }
          })
        }
      }
    )
    return () => controller.abort()
  }, [key, reloadToken])

  const value = settled && settled.key === key ? settled.value : { status: 'loading' as const }
  return { ...value, reload }
}

import { useEffect, useEffectEvent, useState } from 'react'
import { installWindowVisibilityInterval } from '@/lib/window-activity/window-visibility-interval'

export type ProjectOverviewLoad<T> =
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'error'; error: string }

type Settled<T> = { key: string; value: ProjectOverviewLoad<T> }

/**
 * One read for a card. `key` names what is being read: a new key starts over, and the answer to an
 * old key is dropped. Null waits (the project's machine is not known yet). With `liveMs` the read
 * repeats for as long as the page is showing, so the card needs no refresh control.
 */
export function useProjectOverviewLoad<T>(
  key: string | null,
  load: (signal: AbortSignal) => Promise<T>,
  liveMs?: number
): ProjectOverviewLoad<T> {
  const [settled, setSettled] = useState<Settled<T> | null>(null)
  // `load` is a fresh closure each render; `key` says when its inputs changed.
  const run = useEffectEvent(load)

  useEffect(() => {
    if (key === null) {
      return
    }
    const controller = new AbortController()
    let reading = false
    const read = (): void => {
      if (reading) {
        return
      }
      reading = true
      run(controller.signal)
        .then(
          (data) => {
            if (!controller.signal.aborted) {
              setSettled({ key, value: { status: 'ready', data } })
            }
          },
          (error: unknown) => {
            if (controller.signal.aborted) {
              return
            }
            const failed: Settled<T> = {
              key,
              value: {
                status: 'error',
                error: error instanceof Error ? error.message : String(error)
              }
            }
            // A repeat that fails keeps the last answer on screen; the next one tries again.
            setSettled((last) =>
              last?.key === key && last.value.status === 'ready' ? last : failed
            )
          }
        )
        .finally(() => {
          reading = false
        })
    }
    if (liveMs === undefined) {
      read()
      return () => controller.abort()
    }
    const stop = installWindowVisibilityInterval({
      run: read,
      intervalMs: liveMs,
      slowWhileUnfocused: true
    })
    return () => {
      stop()
      controller.abort()
    }
  }, [key, liveMs])

  return settled && settled.key === key ? settled.value : { status: 'loading' }
}

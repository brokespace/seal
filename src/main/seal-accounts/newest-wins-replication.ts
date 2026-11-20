const EDIT_SETTLE_MS = 500

export type NewestWinsReply<C> = { config: C | null; hostKey: string | null }

export type NewestWinsReplies<C, T> = (NewestWinsReply<C> & { entry: T })[]

/**
 * One pass: offers the local config to every host, which keeps the newer of the two and answers
 * with its own. A newer answer is adopted locally and carried to the hosts that missed it.
 * `afterAdopt` may change the local config (returns true): that edit is dated anew, so the
 * follow-up pass carries it instead of re-offering here.
 */
export async function replicateNewestWins<C extends { updatedAt: number }, T>(args: {
  targets: readonly T[]
  local: () => C
  adopt: (config: C) => void
  /** Throws for a host that is offline; it catches up on a later pass. */
  offer: (entry: T, config: C) => Promise<NewestWinsReply<C>>
  afterAdopt?: (replies: NewestWinsReplies<C, T>) => boolean
}): Promise<NewestWinsReplies<C, T>> {
  const offer = async (entry: T, config: C) => {
    try {
      return { entry, ...(await args.offer(entry, config)) }
    } catch {
      return null
    }
  }
  const replies = (
    await Promise.all(args.targets.map((entry) => offer(entry, args.local())))
  ).filter((reply) => reply !== null)
  const newest = replies.reduce<C | null>(
    (best, reply) =>
      reply.config && reply.config.updatedAt > (best?.updatedAt ?? args.local().updatedAt)
        ? reply.config
        : best,
    null
  )
  if (newest) {
    args.adopt(newest)
  }
  if (args.afterAdopt?.(replies)) {
    return replies
  }
  const current = args.local()
  const behind = replies.filter((reply) => (reply.config?.updatedAt ?? -1) < current.updatedAt)
  await Promise.all(behind.map((reply) => offer(reply.entry, current)))
  return replies
}

/** Runs `run` on edits (after a short settle), on hosts coming online and, optionally, on a timer. */
export function startReplicationLoop(args: {
  run: () => Promise<void>
  onEdit: (listener: () => void) => () => void
  onHostOnline: (listener: () => void) => () => void
  intervalMs?: number
  failureMessage: string
}): { stop: () => void; requestPass: () => void } {
  let running: Promise<void> | null = null
  let again = false
  let settle: ReturnType<typeof setTimeout> | null = null
  const run = (): void => {
    if (running) {
      again = true
      return
    }
    running = args
      .run()
      .catch((error: unknown) => {
        console.warn(args.failureMessage, error)
      })
      .finally(() => {
        running = null
        if (again) {
          again = false
          run()
        }
      })
  }
  const unsubscribe = args.onEdit(() => {
    clearTimeout(settle ?? undefined)
    settle = setTimeout(run, EDIT_SETTLE_MS)
    settle.unref?.()
  })
  const unsubscribeOnline = args.onHostOnline(run)
  const timer = args.intervalMs ? setInterval(run, args.intervalMs) : null
  timer?.unref?.()
  run()
  return {
    requestPass: run,
    stop: () => {
      unsubscribe()
      unsubscribeOnline()
      clearTimeout(settle ?? undefined)
      if (timer) {
        clearInterval(timer)
      }
    }
  }
}

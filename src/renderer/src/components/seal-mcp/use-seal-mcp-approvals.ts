import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { toast } from 'sonner'
import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'
import type { SealMcpApprovalRequest } from '../../../../shared/seal-mcp/seal-mcp-types'
import { useTranslate } from '@/i18n/use-translate'
import { readSealMcpApprovals, respondSealMcpApproval, watchSealMcp } from './seal-mcp-watch-feed'

export type SealMcpApprovalAnswer = { approvalId: string; approved: boolean }

/** The same target object for as long as it names the same server. */
export function useStableSealMcpTarget(target: RuntimeClientTarget): RuntimeClientTarget {
  const environmentId = target.kind === 'environment' ? target.environmentId : null
  return useMemo<RuntimeClientTarget>(
    () => (environmentId ? { kind: 'environment', environmentId } : { kind: 'local' }),
    [environmentId]
  )
}

/**
 * MCP calls waiting for an answer on one Seal server, oldest first. A request leaves when the
 * server settles it or when its deadline passes, whichever this app sees first.
 */
export function useSealMcpApprovals(target: RuntimeClientTarget): {
  approvals: readonly SealMcpApprovalRequest[]
  /** The answer being delivered, so its buttons can wait for the server. */
  answering: SealMcpApprovalAnswer | null
  respond: (approvalId: string, approved: boolean) => void
} {
  const t = useTranslate()
  const stable = useStableSealMcpTarget(target)
  const subscribe = useCallback((listener: () => void) => watchSealMcp(stable, listener), [stable])
  const pending = useSyncExternalStore(subscribe, () => readSealMcpApprovals(stable))
  const [now, setNow] = useState(Date.now)
  const [answering, setAnswering] = useState<SealMcpApprovalAnswer | null>(null)

  const nextLapse = Math.min(
    ...pending.map((request) => request.expiresAt).filter((at) => at > now)
  )
  useEffect(() => {
    if (!Number.isFinite(nextLapse)) {
      return
    }
    // A deadline already behind the clock fires at once, so a stale `now` corrects itself.
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, nextLapse - Date.now()))
    return () => clearTimeout(timer)
  }, [nextLapse])

  const approvals = useMemo(
    () => pending.filter((request) => request.expiresAt > now),
    [pending, now]
  )

  const respond = useCallback(
    (approvalId: string, approved: boolean) => {
      setAnswering({ approvalId, approved })
      void respondSealMcpApproval(stable, approvalId, approved)
        .then(
          (settled) => {
            if (!settled) {
              toast.info(
                t(
                  'seal.mcp.approval.alreadySettled',
                  'That request had already expired or been answered.'
                )
              )
            }
          },
          (caught: unknown) => {
            toast.error(t('seal.mcp.approval.respondFailed', 'Could not send your answer'), {
              description: caught instanceof Error ? caught.message : String(caught)
            })
          }
        )
        .finally(() =>
          setAnswering((current) => (current?.approvalId === approvalId ? null : current))
        )
    },
    [stable, t]
  )

  return { approvals, answering, respond }
}

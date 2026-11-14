import { useEffect, useRef, useState } from 'react'
import { installWindowVisibilityInterval } from '@/lib/window-activity/window-visibility-interval'
import { Loader2, TriangleAlert } from 'lucide-react'
import { useTranslate } from '@/i18n/use-translate'
import type { SealMcpApprovalRequest } from '../../../../shared/seal-mcp/seal-mcp-types'
import { Button } from '../ui/button'
import { sealMcpTransportLabel } from './seal-mcp-labels'

// Why 500 ms: a click already on its way when the request appears must not approve it.
const APPROVE_ARMS_AFTER_MS = 500

function formatCountdown(msLeft: number): string {
  const seconds = Math.max(0, Math.ceil(msLeft / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

function useCountdown(expiresAt: number): string {
  const [now, setNow] = useState(Date.now)
  useEffect(
    () => installWindowVisibilityInterval({ run: () => setNow(Date.now()), intervalMs: 1000 }),
    []
  )
  return formatCountdown(expiresAt - now)
}

function Field({
  label,
  children
}: {
  label: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-foreground">{children}</dd>
    </>
  )
}

/** One MCP call waiting for an answer: who asks, how it arrived, what it would run. */
export function SealMcpApprovalRequestView({
  request,
  answering,
  onRespond
}: {
  request: SealMcpApprovalRequest
  /** The answer being delivered for this request, if any. */
  answering: 'approve' | 'deny' | null
  onRespond: (approved: boolean) => void
}): React.JSX.Element {
  const t = useTranslate()
  const countdown = useCountdown(request.expiresAt)
  const rootRef = useRef<HTMLDivElement>(null)
  const denyRef = useRef<HTMLButtonElement>(null)
  const shownAtRef = useRef(Number.POSITIVE_INFINITY)

  // The next request takes this one's place: keyboard focus must not rest on Approve for it.
  useEffect(() => {
    shownAtRef.current = Date.now()
    if (rootRef.current?.contains(document.activeElement)) {
      denyRef.current?.focus()
    }
  }, [request.id])

  // Mouse presses leave focus where it was, so answering does not pull it out of a terminal.
  const keepFocus = (event: React.MouseEvent): void => event.preventDefault()

  return (
    <div ref={rootRef} className="flex min-w-0 flex-col gap-3">
      <div role="alert" className="min-w-0 space-y-2">
        <p className="break-words text-sm font-semibold text-foreground">
          {t('seal.mcp.approval.title', '{{client}} asks to run {{tool}}', {
            client: request.clientName,
            tool: request.tool
          })}
        </p>
        {request.transport === 'relay' ? (
          <p className="flex items-start gap-1.5 rounded-md border border-status-warning-border bg-status-warning-background px-2 py-1.5 text-xs text-status-warning-text">
            <TriangleAlert aria-hidden className="mt-px size-3.5 shrink-0" />
            {t(
              'seal.mcp.approval.relayNotice',
              'This call arrived over the internet through the Seal relay.'
            )}
          </p>
        ) : null}
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
          <Field label={t('seal.mcp.approval.client', 'Client')}>{request.clientName}</Field>
          <Field label={t('seal.mcp.approval.transport', 'Arrived over')}>
            {sealMcpTransportLabel(request.transport, t)}
          </Field>
          <Field label={t('seal.mcp.approval.tool', 'Tool')}>
            <span className="font-mono">{request.tool}</span>
          </Field>
          <Field label={t('seal.mcp.approval.machine', 'Machine')}>
            {request.machine ?? t('seal.mcp.approval.noMachine', 'None named')}
          </Field>
          <Field label={t('seal.mcp.approval.reason', 'Why it asks')}>{request.reason}</Field>
        </dl>
        {request.summary ? (
          <pre
            tabIndex={0}
            aria-label={t('seal.mcp.approval.arguments', 'Arguments')}
            className="max-h-32 overflow-auto rounded-md border border-border bg-muted/40 px-2 py-1.5 font-mono text-xs break-words whitespace-pre-wrap text-foreground scrollbar-sleek focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {request.summary}
          </pre>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground tabular-nums">
          {t('seal.mcp.approval.countdown', 'Seal declines it in {{time}} if nobody answers.', {
            time: countdown
          })}
        </p>
        <div className="ml-auto flex shrink-0 gap-2">
          <Button
            ref={denyRef}
            size="sm"
            variant="secondary"
            disabled={answering !== null}
            onMouseDown={keepFocus}
            onClick={() => onRespond(false)}
          >
            {answering === 'deny' ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {t('seal.mcp.approval.deny', 'Deny')}
          </Button>
          <Button
            size="sm"
            disabled={answering !== null}
            onMouseDown={keepFocus}
            onClick={() => {
              if (Date.now() - shownAtRef.current >= APPROVE_ARMS_AFTER_MS) {
                onRespond(true)
              }
            }}
          >
            {answering === 'approve' ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {t('seal.mcp.approval.approve', 'Approve')}
          </Button>
        </div>
      </div>
    </div>
  )
}

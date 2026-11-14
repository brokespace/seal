import { ShieldQuestion } from 'lucide-react'
import { useTranslate } from '@/i18n/use-translate'
import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'
import type { SealMcpApprovalRequest } from '../../../../shared/seal-mcp/seal-mcp-types'
import { Card } from '../ui/card'
import { SecuritySurface } from '../ui/security-surface'
import { SealMcpApprovalRequestView } from './SealMcpApprovalRequestView'
import { useSealMcpApprovals, type SealMcpApprovalAnswer } from './use-seal-mcp-approvals'

const LOCAL_TARGET: RuntimeClientTarget = { kind: 'local' }

export function sealMcpAnswerInFlight(
  answering: SealMcpApprovalAnswer | null,
  request: SealMcpApprovalRequest
): 'approve' | 'deny' | null {
  if (answering?.approvalId !== request.id) {
    return null
  }
  return answering.approved ? 'approve' : 'deny'
}

/** The oldest waiting MCP call as a corner card; the rest queue behind it. */
export function SealMcpApprovalPromptCard({
  approvals,
  answering,
  onRespond
}: {
  approvals: readonly SealMcpApprovalRequest[]
  answering: SealMcpApprovalAnswer | null
  onRespond: (approvalId: string, approved: boolean) => void
}): React.JSX.Element | null {
  const t = useTranslate()
  const request = approvals[0]
  if (!request) {
    return null
  }
  return (
    <SecuritySurface>
      <div data-seal-mcp-approval-prompt="">
        <Card
          className="gap-0 py-0 shadow-floating"
          role="group"
          aria-labelledby="seal-mcp-approval-heading"
        >
          <div className="flex flex-col gap-2.5 p-3.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <ShieldQuestion aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                <h3 id="seal-mcp-approval-heading" className="truncate text-sm font-semibold">
                  {t('seal.mcp.approval.heading', 'MCP call needs your approval')}
                </h3>
              </div>
              {approvals.length > 1 ? (
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {t('seal.mcp.approval.queue', '1 of {{total}}', { total: approvals.length })}
                </span>
              ) : null}
            </div>
            <SealMcpApprovalRequestView
              request={request}
              answering={sealMcpAnswerInFlight(answering, request)}
              onRespond={(approved) => onRespond(request.id, approved)}
            />
          </div>
        </Card>
      </div>
    </SecuritySurface>
  )
}

/** Shows MCP calls waiting on this computer's Seal server, on whatever view is open. */
export function SealMcpApprovalPrompt(): React.JSX.Element | null {
  const { approvals, answering, respond } = useSealMcpApprovals(LOCAL_TARGET)
  return (
    <SealMcpApprovalPromptCard approvals={approvals} answering={answering} onRespond={respond} />
  )
}

import { defineFixture } from '../../component-fixtures/component-fixture'
import type { SealMcpApprovalRequest } from '../../../../shared/seal-mcp/seal-mcp-types'
import { SealMcpApprovalPromptCard } from './SealMcpApprovalPrompt'

function request(overrides: Partial<SealMcpApprovalRequest>): SealMcpApprovalRequest {
  return {
    id: 'p1',
    clientId: 'c1',
    clientName: 'Claude Code on my laptop',
    transport: 'stdio',
    tool: 'delete_workspace',
    machine: 'This computer',
    summary: '{"workspace":"acme-web/fix-login","force":true}',
    reason: 'This tool is destructive.',
    requestedAt: Date.now(),
    expiresAt: Date.now() + 96_000,
    ...overrides
  }
}

// The corner stack's width and surface tokens, as the app mounts the card.
function Corner({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="notification-card-stack w-[360px]">{children}</div>
}

export const destructiveCall = defineFixture({
  width: 392,
  render: () => (
    <Corner>
      <SealMcpApprovalPromptCard approvals={[request({})]} answering={null} onRespond={() => {}} />
    </Corner>
  )
})

export const relayCallWithQueue = defineFixture({
  width: 392,
  render: () => (
    <Corner>
      <SealMcpApprovalPromptCard
        approvals={[
          request({
            clientName: 'Cursor (travel)',
            transport: 'relay',
            tool: 'run_command',
            machine: 'Studio Mac',
            summary: '{"command":"git push origin main","cwd":"/Users/sam/acme/web"}',
            reason: 'This client asks before every command.'
          }),
          request({ id: 'p2' }),
          request({ id: 'p3' })
        ]}
        answering={null}
        onRespond={() => {}}
      />
    </Corner>
  )
})

export const sendingAnswer = defineFixture({
  width: 392,
  render: () => (
    <Corner>
      <SealMcpApprovalPromptCard
        approvals={[request({ machine: null })]}
        answering={{ approvalId: 'p1', approved: false }}
        onRespond={() => {}}
      />
    </Corner>
  )
})

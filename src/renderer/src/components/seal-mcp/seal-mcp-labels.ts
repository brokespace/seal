import type { Translate } from '@/i18n/use-translate'
import type {
  SealMcpApprovalPolicy,
  SealMcpAuditOutcome,
  SealMcpScope,
  SealMcpTransport
} from '../../../../shared/seal-mcp/seal-mcp-types'

export function sealMcpScopeLabel(scope: SealMcpScope, t: Translate): string {
  switch (scope) {
    case 'read':
      return t('seal.mcp.scope.read', 'Read')
    case 'sessions':
      return t('seal.mcp.scope.sessions', 'Sessions')
    case 'files':
      return t('seal.mcp.scope.files', 'Files')
    case 'commands':
      return t('seal.mcp.scope.commands', 'Commands')
    case 'destructive':
      return t('seal.mcp.scope.destructive', 'Destructive')
  }
}

export function sealMcpScopeDescription(scope: SealMcpScope, t: Translate): string {
  switch (scope) {
    case 'read':
      return t(
        'seal.mcp.scope.readDescription',
        'List machines, sessions, projects, workspaces, usage and skills.'
      )
    case 'sessions':
      return t('seal.mcp.scope.sessionsDescription', 'Message and start agent sessions.')
    case 'files':
      return t('seal.mcp.scope.filesDescription', 'Read and write files on the allowed machines.')
    case 'commands':
      return t(
        'seal.mcp.scope.commandsDescription',
        'Run shell commands. This is effectively full access to the allowed machines as your user.'
      )
    case 'destructive':
      return t(
        'seal.mcp.scope.destructiveDescription',
        'Delete files, stop sessions, switch accounts, and run commands Seal flags as risky.'
      )
  }
}

export function sealMcpApprovalPolicyLabel(policy: SealMcpApprovalPolicy, t: Translate): string {
  switch (policy) {
    case 'never':
      return t('seal.mcp.policy.never', 'Never ask')
    case 'destructive':
      return t('seal.mcp.policy.destructive', 'Ask before destructive calls')
    case 'commands':
      return t('seal.mcp.policy.commands', 'Ask before every command too')
  }
}

export function sealMcpTransportLabel(transport: SealMcpTransport, t: Translate): string {
  switch (transport) {
    case 'stdio':
      return t('seal.mcp.transport.stdio', 'stdio')
    case 'http':
      return t('seal.mcp.transport.http', 'HTTP')
    case 'relay':
      return t('seal.mcp.transport.relay', 'Relay')
  }
}

export function sealMcpOutcomeLabel(outcome: SealMcpAuditOutcome, t: Translate): string {
  switch (outcome) {
    case 'ok':
      return t('seal.mcp.outcome.ok', 'OK')
    case 'error':
      return t('seal.mcp.outcome.error', 'Error')
    case 'unauthorized':
      return t('seal.mcp.outcome.unauthorized', 'Unauthorized')
    case 'scope-denied':
      return t('seal.mcp.outcome.scopeDenied', 'Scope denied')
    case 'machine-denied':
      return t('seal.mcp.outcome.machineDenied', 'Machine denied')
    case 'approval-denied':
      return t('seal.mcp.outcome.approvalDenied', 'Not approved')
    case 'rate-limited':
      return t('seal.mcp.outcome.rateLimited', 'Rate limited')
  }
}

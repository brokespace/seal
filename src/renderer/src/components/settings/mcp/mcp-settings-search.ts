import { createLocalizedCatalog } from '@/i18n/localized-catalog'
import { translate } from '@/i18n/i18n'
import type { SettingsSearchEntry } from '../search/settings-search'
import { translateSearchKeyword } from '../search/settings-search-keywords'

export const getMcpSettingsSearchEntries = createLocalizedCatalog((): SettingsSearchEntry[] => [
  {
    title: translate('seal.mcp.endpoints.title', 'Endpoints'),
    description: translate(
      'seal.mcp.search.endpointsDescription',
      'Turn the HTTP and Seal relay MCP endpoints on or off and copy their URLs.'
    ),
    keywords: [
      ...translateSearchKeyword('seal.mcp.search.keywordMcp', 'mcp'),
      ...translateSearchKeyword(
        'seal.mcp.search.keywordModelContextProtocol',
        'model context protocol'
      ),
      ...translateSearchKeyword('seal.mcp.search.keywordHttp', 'http'),
      ...translateSearchKeyword('seal.mcp.search.keywordRelay', 'relay'),
      ...translateSearchKeyword('seal.mcp.search.keywordStdio', 'stdio'),
      ...translateSearchKeyword('seal.mcp.search.keywordUrl', 'url'),
      ...translateSearchKeyword('seal.mcp.search.keywordServer', 'server')
    ]
  },
  {
    title: translate('seal.mcp.clients.title', 'Clients'),
    description: translate(
      'seal.mcp.search.clientsDescription',
      'Add, revoke and remove MCP clients, and choose what each token may do.'
    ),
    keywords: [
      ...translateSearchKeyword('seal.mcp.search.keywordMcp', 'mcp'),
      ...translateSearchKeyword('seal.mcp.search.keywordToken', 'token'),
      ...translateSearchKeyword('seal.mcp.search.keywordClient', 'client'),
      ...translateSearchKeyword('seal.mcp.search.keywordScope', 'scope'),
      ...translateSearchKeyword('seal.mcp.search.keywordRevoke', 'revoke'),
      ...translateSearchKeyword('seal.mcp.search.keywordApproval', 'approval'),
      ...translateSearchKeyword('seal.mcp.search.keywordPermission', 'permission')
    ]
  },
  {
    title: translate('seal.mcp.connect.title', 'Connect a client'),
    description: translate(
      'seal.mcp.search.connectDescription',
      'Setup text for Claude Code, Codex, Cursor and other MCP clients.'
    ),
    keywords: [
      ...translateSearchKeyword('seal.mcp.search.keywordMcp', 'mcp'),
      ...translateSearchKeyword('seal.mcp.search.keywordClaudeCode', 'claude code'),
      ...translateSearchKeyword('seal.mcp.search.keywordCodex', 'codex'),
      ...translateSearchKeyword('seal.mcp.search.keywordCursor', 'cursor'),
      ...translateSearchKeyword('seal.mcp.search.keywordSetup', 'setup'),
      ...translateSearchKeyword('seal.mcp.search.keywordConfig', 'config')
    ]
  },
  {
    title: translate('seal.mcp.audit.title', 'Audit log'),
    description: translate(
      'seal.mcp.search.auditDescription',
      'Every MCP request this server received, with who sent it and how it ended.'
    ),
    keywords: [
      ...translateSearchKeyword('seal.mcp.search.keywordMcp', 'mcp'),
      ...translateSearchKeyword('seal.mcp.search.keywordAudit', 'audit'),
      ...translateSearchKeyword('seal.mcp.search.keywordLog', 'log'),
      ...translateSearchKeyword('seal.mcp.search.keywordHistory', 'history'),
      ...translateSearchKeyword('seal.mcp.search.keywordDenied', 'denied')
    ]
  }
])

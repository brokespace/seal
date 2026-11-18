import { describe, expect, it } from 'vitest'
import { claudeAlwaysLoadMcpServers } from './claude-always-load-mcp-servers'

const PROJECT = '/work/repo'

describe('claudeAlwaysLoadMcpServers', () => {
  it('restates only plain stdio servers Claude would hold start-up for', () => {
    const config = {
      mcpServers: {
        codegraph: { type: 'stdio', command: 'codegraph', args: ['serve'], alwaysLoad: true },
        keyed: { command: 'keyed', env: { TOKEN: 'x' }, alwaysLoad: true },
        remote: { type: 'http', url: 'https://example.test/mcp', alwaysLoad: true },
        lazy: { command: 'lazy' },
        shadowed: { command: 'user-copy', alwaysLoad: true },
        off: { command: 'off', alwaysLoad: true }
      },
      projects: {
        [PROJECT]: {
          mcpServers: {
            shadowed: { command: 'local-copy' },
            local: { command: 'local', alwaysLoad: true, timeout: 9000 }
          },
          disabledMcpServers: ['off']
        }
      }
    }
    expect(claudeAlwaysLoadMcpServers(config, PROJECT)).toEqual({
      codegraph: { type: 'stdio', command: 'codegraph', args: ['serve'] },
      local: { type: 'stdio', command: 'local', timeout: 9000 }
    })
  })
})

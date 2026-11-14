import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { fixtureHomeFiles } from '../../../src/main/agent-config/testing/agent-config-fixture-trees'
import type { Target } from '../home-chat-tools/tool-case-types'

export const ECHO_MCP_TOKEN = 'tok-echo-secret-7'
export const HTTP_MCP_TOKEN = 'tok-http-secret-8'

/** A stdio MCP server that answers the handshake only when its token arrived in the environment. */
const ECHO_MCP = `#!/bin/sh
[ "$ECHO_TOKEN" = "${ECHO_MCP_TOKEN}" ] || { echo "echo-mcp: ECHO_TOKEN is missing" >&2; exit 3; }
read -r _request
printf '%s\\n' '{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18","capabilities":{},"serverInfo":{"name":"echo-mcp","version":"0.4.2"}}}'
sleep 2
`

/** Stands in for Claude Code where the real CLI is not installed: it says what it was asked. */
const CLAUDE_SHIM = `#!/bin/sh
echo "claude-shim: $*"
`

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

/** Each login shell reads a different startup file; all of them must put the agent CLIs on PATH. */
function writeLoginPath(target: Target, extraPath: string | null): void {
  const dirs = [`${target.home}/bin`, ...(extraPath ? extraPath.split(':') : [])]
  if (target.loginShell.endsWith('fish')) {
    target.sh(
      'mkdir -p ~/.config/fish && cat >> ~/.config/fish/config.fish',
      `set -gx PATH ${dirs.map(shellQuote).join(' ')} $PATH\n`
    )
    return
  }
  const file = target.loginShell.endsWith('zsh') ? '~/.zprofile' : '~/.profile'
  target.sh(`cat >> ${file}`, `export PATH=${shellQuote(dirs.join(':'))}:"$PATH"\n`)
}

/**
 * Leaves the account the way Claude Code and Codex would: the same tree the unit fixtures use.
 * `realCliPath` puts real agent CLIs on PATH; without it a shim named `claude` stands in.
 */
export function seedAgentConfig(target: Target, realCliPath: string | null): void {
  const files: Record<string, string> = {
    ...fixtureHomeFiles(target.home),
    'bin/echo-mcp': ECHO_MCP,
    // A marketplace on the machine's own disk, so adding it and installing from it needs no network.
    'seal-mkt/.claude-plugin/marketplace.json': JSON.stringify({
      name: 'seal-mkt',
      owner: { name: 'seal' },
      plugins: [{ name: 'greeter', source: './plugins/greeter', description: 'Greets you' }]
    }),
    'seal-mkt/plugins/greeter/.claude-plugin/plugin.json': JSON.stringify({
      name: 'greeter',
      version: '1.0.0',
      description: 'Greets you'
    }),
    'seal-mkt/plugins/greeter/commands/greet.md': 'Say hello.\n',
    ...(realCliPath ? {} : { 'bin/claude': CLAUDE_SHIM })
  }
  const script = Object.entries(files)
    .map(([relative, content]) => {
      const file = shellQuote(`${target.home}/${relative}`)
      const encoded = Buffer.from(content).toString('base64')
      return `mkdir -p "$(dirname ${file})" && printf %s ${encoded} | base64 -d > ${file}`
    })
    .join('\n')
  target.sh('sh -s', `set -e\n${script}\n`)
  target.sh(
    'chmod 600 ~/.claude.json ~/.codex/config.toml && chmod 755 ~/bin/* ~/.claude/skills/deploy-app/scripts/deploy.sh'
  )
  writeLoginPath(target, realCliPath)
}

export function readOnMachine(target: Target, relative: string): string {
  return target.sh(`cat "$HOME/${relative}"`).toString()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** A value inside a JSON file on the machine, by key path. */
export function jsonOnMachine(target: Target, relative: string, ...keys: string[]): unknown {
  return keys.reduce<unknown>(
    (node, key) => (isRecord(node) ? node[key] : undefined),
    JSON.parse(readOnMachine(target, relative))
  )
}

export function existsOnMachine(target: Target, relative: string): boolean {
  return target.sh(`[ -e "$HOME/${relative}" ] && echo yes || echo no`).toString().trim() === 'yes'
}

/** Backups Seal kept of one file, oldest first, as paths under the account's home. */
export function backupsOf(target: Target, relative: string): string[] {
  return target
    .sh(`ls -d "$HOME"/.seal/config-backups/*"$HOME/${relative}" 2>/dev/null || true`)
    .toString()
    .split('\n')
    .filter(Boolean)
    .toSorted()
}

/** An HTTP MCP server that wants a bearer token, as hosted servers do. */
export async function startHttpMcp(): Promise<{ url: string; server: Server }> {
  const server = createServer((req, res) => {
    if (req.headers.authorization !== `Bearer ${HTTP_MCP_TOKEN}`) {
      res.writeHead(401, { 'WWW-Authenticate': 'Bearer' })
      res.end('{"error":"unauthorized"}')
      return
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        result: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          serverInfo: { name: 'http-mcp', version: '2.1.0' }
        }
      })
    )
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: a TCP listener's address is an AddressInfo.
  const { port } = server.address() as AddressInfo
  return { url: `http://127.0.0.1:${port}/mcp`, server }
}

import { mcpCodec } from '../../shared/agent-config/agent-config-mcp-codec'
import { parseJsonObject } from '../../shared/agent-config/agent-config-json-edit'
import { rawMcpEntry } from '../../shared/agent-config/agent-config-mcp-servers'
import { isSecretValue } from '../../shared/agent-config/agent-config-secrets'
import { parseTomlObject } from '../../shared/agent-config/agent-config-toml-edit'
import {
  AGENT_CONFIG_SECRET_MASK,
  type AgentConfigMcpAuth,
  type AgentConfigMcpTestResult,
  type AgentConfigScope,
  type AgentConfigTarget
} from '../../shared/agent-config/agent-config-types'
import { isPlainObject } from '../../shared/agent-config/agent-config-values'
import { quotePosixShell } from '../../shared/shell/launch/shell-argument-quoting'
import type { MachineConnection } from '../machines/connection/machine-connection'
import { readConfigFile } from './agent-config-file-io'
import { joinRelative, mcpFile, resolveTarget } from './agent-config-locations'

const PROBE_TIMEOUT_MS = 30_000
const STDIO_WAIT_SECONDS = 15
const HTTP_WAIT_SECONDS = 15
const SSE_WAIT_SECONDS = 6
const MARK = '--seal-probe--'

const INITIALIZE = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'seal', version: '1' }
  }
})

function curlQuoted(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}

/**
 * The script goes to `sh -s` on stdin, so tokens in variables, headers and URLs never appear in
 * a process list on the machine.
 */
function stdioScript(
  command: string,
  args: readonly string[],
  env: Record<string, string>
): string {
  return [
    ...Object.entries(env)
      .filter(([key]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key))
      .map(([key, value]) => `export ${key}=${quotePosixShell(value)}`),
    'out=$(mktemp) || exit 1; err=$(mktemp) || exit 1',
    `( printf '%s\\n' ${quotePosixShell(INITIALIZE)}; sleep ${STDIO_WAIT_SECONDS} ) 2>/dev/null </dev/null | ${[command, ...args].map(quotePosixShell).join(' ')} >"$out" 2>"$err" &`,
    'pid=$!',
    'i=0',
    `while [ "$i" -lt ${STDIO_WAIT_SECONDS * 5} ]; do`,
    `  grep -Eq '"(result|error)"' "$out" 2>/dev/null && break`,
    '  kill -0 "$pid" 2>/dev/null || break',
    '  sleep 0.2; i=$((i+1))',
    'done',
    'kill "$pid" 2>/dev/null',
    'head -c 8000 "$out"',
    `printf '\\n${MARK}\\n'`,
    'tail -c 600 "$err"',
    'rm -f "$out" "$err"'
  ].join('\n')
}

function httpScript(
  url: string,
  headers: Record<string, string>,
  sse: boolean,
  bearerEnvVar: string | null
): string {
  const lines = [
    `url = ${curlQuoted(url)}`,
    `max-time = ${sse ? SSE_WAIT_SECONDS : HTTP_WAIT_SECONDS}`,
    ...(sse
      ? ['header = "Accept: text/event-stream"']
      : [
          'request = "POST"',
          'header = "Content-Type: application/json"',
          'header = "Accept: application/json, text/event-stream"',
          `data = ${curlQuoted(INITIALIZE)}`
        ]),
    ...Object.entries(headers).map(([name, value]) => `header = ${curlQuoted(`${name}: ${value}`)}`)
  ]
  const bearer =
    bearerEnvVar && /^[A-Za-z_][A-Za-z0-9_]*$/.test(bearerEnvVar)
      ? `[ -n "\${${bearerEnvVar}:-}" ] && printf 'header = "Authorization: Bearer %s"\\n' "\$${bearerEnvVar}"`
      : ':'
  return [
    'command -v curl >/dev/null 2>&1 || { echo nocurl; exit 0; }',
    'out=$(mktemp) || exit 1; err=$(mktemp) || exit 1',
    `code=$({ printf '%s\\n' ${lines.map(quotePosixShell).join(' ')}; ${bearer}; } | curl -sS -K - -o "$out" -w '%{http_code}' 2>"$err")`,
    'printf \'%s\\n\' "$code"',
    'head -c 8000 "$out"',
    `printf '\\n${MARK}\\n'`,
    'head -c 600 "$err"',
    'rm -f "$out" "$err"'
  ].join('\n')
}

function serverInfo(body: string): { name?: string; version?: string; error?: string } | null {
  for (const line of body.split('\n')) {
    const text = line.startsWith('data:') ? line.slice(5).trim() : line.trim()
    if (!text.startsWith('{')) {
      continue
    }
    try {
      const message: unknown = JSON.parse(text)
      if (!isPlainObject(message)) {
        continue
      }
      if (isPlainObject(message.error)) {
        return { error: String(message.error.message ?? 'The server refused the handshake') }
      }
      if (isPlainObject(message.result)) {
        const info = message.result.serverInfo
        return isPlainObject(info)
          ? { name: String(info.name ?? ''), version: String(info.version ?? '') }
          : {}
      }
    } catch {
      // Not the handshake reply; keep looking.
    }
  }
  return null
}

function redact(text: string, secrets: readonly string[]): string {
  return secrets
    .filter((secret) => secret.length >= 4)
    .reduce((out, secret) => out.replaceAll(secret, AGENT_CONFIG_SECRET_MASK), text)
    .trim()
}

function lastLine(text: string): string {
  return text.split('\n').findLast((line) => line.trim() !== '') ?? ''
}

async function signedInWithOAuth(
  connection: MachineConnection,
  home: string,
  name: string
): Promise<boolean> {
  // Claude Code on Linux keeps MCP OAuth sessions here; on macOS they are in the keychain.
  const read = await connection.files
    .readFile(joinRelative(home, '.claude/.credentials.json'), 4 * 1024 * 1024)
    .catch(() => null)
  const parsed = read ? parseJsonObject(read.data.toString('utf8')) : null
  const sessions = parsed?.ok ? parsed.value.mcpOAuth : null
  return (
    isPlainObject(sessions) &&
    Object.entries(sessions).some(
      ([key, session]) =>
        key.split('|')[0] === name && isPlainObject(session) && Boolean(session.accessToken)
    )
  )
}

/** Starts the server (or calls its URL) on the machine itself and reports the MCP handshake. */
export async function testMcpServer(
  connection: MachineConnection,
  args: { target: AgentConfigTarget; scope: AgentConfigScope; name: string }
): Promise<AgentConfigMcpTestResult> {
  const started = Date.now()
  const resolved = resolveTarget(args.target, await connection.files.homeDir())
  const file = mcpFile(resolved, args.scope)
  if (!file) {
    throw new Error(`${resolved.layout.label} keeps no MCP servers in the ${args.scope} scope`)
  }
  const read = await readConfigFile(connection, file.location.sourcePath)
  const parsed =
    file.format === 'toml' ? parseTomlObject(read.content) : parseJsonObject(read.content)
  const entry = parsed.ok ? rawMcpEntry(parsed.value, file.location, args.name) : undefined
  if (!entry) {
    throw new Error(`"${args.name}" is not in ${file.location.sourcePath} any more`)
  }
  const fields = mcpCodec(file.location.codec).read(entry)
  const done = (
    result: Omit<AgentConfigMcpTestResult, 'durationMs'>
  ): AgentConfigMcpTestResult => ({ ...result, durationMs: Date.now() - started })
  if ((await connection.dialect()) !== 'posix') {
    return done({
      status: 'unsupported',
      auth: 'unknown',
      detail: 'Testing a server is not available on Windows machines yet'
    })
  }
  const secrets = [...Object.values(fields.env), ...Object.values(fields.headers), ...fields.args]
  const run = async (
    script: string
  ): Promise<{ body: string; errors: string; timedOut: boolean }> => {
    const output = await connection.exec('exec /bin/sh -s', {
      timeoutMs: PROBE_TIMEOUT_MS,
      stdin: script,
      ...(resolved.projectRoot ? { cwd: resolved.projectRoot } : {})
    })
    const [body = '', errors = ''] = output.stdout.split(`\n${MARK}\n`)
    return { body, errors: redact(errors || output.stderr, secrets), timedOut: output.timedOut }
  }

  if (fields.transport === 'stdio') {
    const auth: AgentConfigMcpAuth = Object.entries(fields.env).some(([key, value]) =>
      isSecretValue(key, value)
    )
      ? 'env-token'
      : 'none'
    const { body, errors, timedOut } = await run(
      stdioScript(fields.command, fields.args, fields.env)
    )
    const info = serverInfo(body)
    if (info && !info.error) {
      return done({
        status: 'connected',
        auth,
        detail: [info.name, info.version].filter(Boolean).join(' ') || 'The server answered',
        ...(info.name ? { serverName: info.name } : {}),
        ...(info.version ? { serverVersion: info.version } : {})
      })
    }
    return done({
      status: 'failed',
      auth,
      detail:
        info?.error ??
        (lastLine(errors) ||
          (timedOut ? 'The server did not answer in time' : 'The server exited without answering'))
    })
  }

  const staticAuth = Object.entries(fields.headers).some(([key, value]) =>
    isSecretValue(key, value)
  )
  const bearerEnvVar =
    typeof entry.bearer_token_env_var === 'string' ? entry.bearer_token_env_var : null
  const { body, errors } = await run(
    httpScript(fields.url, fields.headers, fields.transport === 'sse', bearerEnvVar)
  )
  if (body.trim() === 'nocurl') {
    return done({
      status: 'unsupported',
      auth: 'unknown',
      detail: 'curl is not installed on this machine'
    })
  }
  const newline = body.indexOf('\n')
  const httpStatus = Number.parseInt(newline === -1 ? body : body.slice(0, newline), 10) || 0
  const info = serverInfo(newline === -1 ? '' : body.slice(newline + 1))
  const auth: AgentConfigMcpAuth = staticAuth
    ? 'static-header'
    : bearerEnvVar
      ? 'env-token'
      : 'none'
  if (httpStatus === 401 || httpStatus === 403) {
    const oauth =
      !staticAuth &&
      resolved.layout.id === 'claude' &&
      (await signedInWithOAuth(connection, resolved.home, args.name))
    return done({
      status: 'needs-auth',
      auth: oauth ? 'oauth-signed-in' : 'needs-auth',
      detail: oauth
        ? `${resolved.layout.label} holds a sign-in for this server; this test does not use it`
        : staticAuth
          ? `The server rejected the configured credentials (HTTP ${httpStatus})`
          : `The server wants you to sign in (HTTP ${httpStatus})`,
      httpStatus
    })
  }
  if (httpStatus >= 200 && httpStatus < 300 && !info?.error) {
    return done({
      status: 'connected',
      auth,
      detail: [info?.name, info?.version].filter(Boolean).join(' ') || `HTTP ${httpStatus}`,
      httpStatus,
      ...(info?.name ? { serverName: info.name } : {}),
      ...(info?.version ? { serverVersion: info.version } : {})
    })
  }
  return done({
    status: 'failed',
    auth,
    detail: info?.error ?? (httpStatus ? `HTTP ${httpStatus}` : lastLine(errors) || 'No answer'),
    ...(httpStatus ? { httpStatus } : {})
  })
}

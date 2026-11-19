import { randomUUID } from 'node:crypto'
import { mkdir, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { LOCAL_MACHINE_ID } from '../../shared/machines/machine-types'
import type {
  SealConnectorsSignInResult,
  SealConnectorsSignInStart
} from '../../shared/rpc-contract/seal-connectors-params'
import {
  APPLIES_TO_ALL,
  SignInSecretSchema,
  type Connector,
  type SignInRef,
  type SignInSecret
} from '../../shared/seal-connectors/seal-connectors-types'
import {
  claudeConfigDirKeychainAliases,
  claudeKeychainService,
  getKeychainUser
} from '../claude-accounts/runtime-auth/keychain'
import { writeSecureFile } from '../../shared/secure-storage/secure-file'
import { execSecurityCommand, isKeychainNotFoundError } from '../macos-keychain/generic-password'
import type {
  MachineConnection,
  MachineShellDialect
} from '../machines/connection/machine-connection'
import { resolveMachineConnection } from '../machines/machine-services'
import { quoteForMachineShell } from '../machines/work/machine-worktrees'
import { entryExpiry, isSignedIn, readMcpOAuthEntries } from './claude-mcp-oauth-entries'
import { getSealConnectorsHost, type SealConnectorsHost } from './seal-connectors-host'
import {
  cancelConnectorSignIn,
  startConnectorSignIn,
  submitConnectorRedirect,
  waitForConnectorSignIn
} from './seal-connectors-sign-in-session'

const KEEP_ATTEMPT_MS = 60_000
// The CLI session ends itself after ten minutes; leave room to read what it saved.
const ATTEMPT_LIMIT_MS = 12 * 60_000

type Attempt = {
  dir: string
  connectorId: string
  signInId: string | null
  sessionId: string | null
  cancelled: boolean
  outcome: Promise<SealConnectorsSignInResult> | null
}

const attempts = new Map<string, Attempt>()

function signInRoot(userData: string): string {
  return join(userData, 'seal-connectors', 'sign-in')
}

function failed(message: string): SealConnectorsSignInResult {
  return { ok: false, message, signInId: null }
}

function requireHost(): SealConnectorsHost {
  const host = getSealConnectorsHost()
  if (!host) {
    throw new Error('Connectors are not ready on this host yet')
  }
  return host
}

/** `claude mcp login` for a fresh config folder, in the machine's own shell dialect. */
export function connectorLoginCommand(
  configDir: string,
  name: string,
  dialect: MachineShellDialect
): string {
  const dir = quoteForMachineShell(configDir, dialect)
  const server = quoteForMachineShell(name, dialect)
  if (dialect === 'powershell') {
    return `$env:CLAUDE_CONFIG_DIR=${dir}; & claude mcp login ${server} --no-browser; exit $LASTEXITCODE`
  }
  // `env` works from sh, bash, zsh and fish alike; the PTY runs it in the login shell.
  return `env CLAUDE_CONFIG_DIR=${dir} claude mcp login ${server} --no-browser`
}

function claudeJsonFor(connector: Connector): string {
  if (connector.transport.type !== 'http') {
    throw new Error('Only connectors with a web address can be signed in')
  }
  const { url, oauth } = connector.transport
  return JSON.stringify({
    mcpServers: { [connector.name]: { type: 'http', url, ...(oauth ? { oauth } : {}) } }
  })
}

async function dropKeychainItems(dir: string): Promise<void> {
  if (process.platform !== 'darwin') {
    return
  }
  // Only the item Claude hashed from this attempt's own folder; never the Claude login items.
  for (const alias of claudeConfigDirKeychainAliases(dir)) {
    await execSecurityCommand([
      'delete-generic-password',
      '-s',
      claudeKeychainService(alias),
      '-a',
      getKeychainUser()
    ]).catch((error: unknown) => {
      if (!isKeychainNotFoundError(error)) {
        throw error
      }
    })
  }
}

async function removeAttemptFolder(dir: string): Promise<void> {
  await dropKeychainItems(dir).catch(() => {})
  await rm(dir, { recursive: true, force: true }).catch(() => {})
}

/** Folders left by an app that quit mid-sign-in; nothing in this process owns them. */
async function sweepStaleAttempts(userData: string): Promise<void> {
  const root = signInRoot(userData)
  const names = await readdir(root).catch(() => [])
  const live = new Set([...attempts.values()].map((attempt) => attempt.dir))
  await Promise.all(
    names
      .map((name) => join(root, name))
      .filter((dir) => !live.has(dir))
      .map((dir) => removeAttemptFolder(dir))
  )
}

function newestEntry(
  entries: Awaited<ReturnType<typeof readMcpOAuthEntries>>,
  name: string
): [string, Record<string, unknown>] | null {
  const found = Object.entries(entries).filter(
    ([key, entry]) => key.split('|')[0] === name && isSignedIn(entry)
  )
  return found.toSorted(([, a], [, b]) => entryExpiry(b) - entryExpiry(a))[0] ?? null
}

function uniqueLabel(connector: Connector): string {
  const taken = new Set(connector.signIns.map((ref) => ref.label))
  let n = connector.signIns.length + 1
  while (taken.has(`${connector.title} ${n}`)) {
    n += 1
  }
  return `${connector.title} ${n}`
}

function newSignInRef(connector: Connector, id: string): SignInRef {
  return {
    id,
    label: uniqueLabel(connector),
    kind: 'oauth',
    createdAt: Date.now(),
    enabled: true,
    appliesTo: APPLIES_TO_ALL,
    projectOverrides: []
  }
}

/** Moves what Claude Code saved in the attempt's folder into Seal's sign-in store and list. */
async function adoptSignIn(attempt: Attempt): Promise<SealConnectorsSignInResult> {
  const host = requireHost()
  const connector = host.config().connectors.find((item) => item.id === attempt.connectorId)
  if (!connector) {
    return failed('That connector was removed while you were signing in')
  }
  const found = newestEntry(await readMcpOAuthEntries(attempt.dir), connector.name)
  if (!found) {
    return failed('Claude Code finished, but no sign-in was saved. Try Connect again.')
  }
  const id = attempt.signInId ?? `si_${randomUUID()}`
  const parsed = SignInSecretSchema.safeParse({
    kind: 'oauth',
    id,
    connectorId: connector.id,
    mcpOAuthKey: found[0],
    entry: found[1],
    updatedAt: Date.now()
  })
  if (!parsed.success) {
    return failed('Claude Code saved a sign-in Seal could not read')
  }
  const secret: SignInSecret = parsed.data
  host.saveSignIn(secret)
  host.editConfig((config) => ({
    ...config,
    connectors: config.connectors.map((item) =>
      item.id !== connector.id || item.signIns.some((ref) => ref.id === id)
        ? item
        : { ...item, signIns: [...item.signIns, newSignInRef(item, id)] }
    )
  }))
  host.markNeedsReconnect(id, false)
  return { ok: true, message: `Connected ${connector.title}`, signInId: id }
}

async function finish(
  attemptId: string,
  attempt: Attempt,
  result: { ok: boolean; message: string | null }
): Promise<SealConnectorsSignInResult> {
  try {
    if (attempt.cancelled) {
      return failed('Sign-in cancelled')
    }
    if (!result.ok) {
      return failed(result.message ?? 'Claude Code did not finish the sign-in')
    }
    return await adoptSignIn(attempt)
  } catch (error) {
    return failed(error instanceof Error ? error.message : 'Sign-in failed')
  } finally {
    await removeAttemptFolder(attempt.dir)
    setTimeout(() => attempts.delete(attemptId), KEEP_ATTEMPT_MS).unref()
  }
}

/**
 * Starts Claude Code's own MCP sign-in for a connector on this host and returns the page the
 * user opens (the renderer opens it). The tokens end up in Seal's store, never in a Claude home.
 */
export async function startSealConnectorSignIn(
  input: { connectorId: string; signInId: string | null },
  deps: { userData: string; connection?: MachineConnection }
): Promise<SealConnectorsSignInStart> {
  const host = requireHost()
  await host.ready()
  const connector = host.config().connectors.find((item) => item.id === input.connectorId)
  if (!connector) {
    throw new Error('That connector is not in the list')
  }
  if (connector.transport.type !== 'http' || connector.auth !== 'oauth') {
    throw new Error('This connector does not use a browser sign-in')
  }
  if (input.signInId && !connector.signIns.some((ref) => ref.id === input.signInId)) {
    throw new Error('That sign-in is not on this connector')
  }
  await sweepStaleAttempts(deps.userData)
  const attemptId = randomUUID()
  const dir = join(signInRoot(deps.userData), attemptId)
  const attempt: Attempt = {
    dir,
    connectorId: connector.id,
    signInId: input.signInId,
    sessionId: null,
    cancelled: false,
    outcome: null
  }
  attempts.set(attemptId, attempt)
  try {
    await mkdir(dir, { recursive: true, mode: 0o700 })
    writeSecureFile(join(dir, '.claude.json'), claudeJsonFor(connector))
    const connection = deps.connection ?? resolveMachineConnection(LOCAL_MACHINE_ID)
    await connection.connect()
    const command = connectorLoginCommand(dir, connector.name, await connection.dialect())
    const started = await startConnectorSignIn(connection, command, connector.name)
    if (started.kind === 'finished') {
      const result = await finish(attemptId, attempt, started.result)
      return { kind: 'finished', result }
    }
    attempt.sessionId = started.sessionId
    attempt.outcome = waitForConnectorSignIn(started.sessionId).then((result) =>
      finish(attemptId, attempt, result)
    )
    const limit = setTimeout(() => cancelSealConnectorSignIn(attemptId), ATTEMPT_LIMIT_MS)
    limit.unref()
    void attempt.outcome.finally(() => clearTimeout(limit))
    return { kind: 'url', attemptId, url: started.url }
  } catch (error) {
    attempts.delete(attemptId)
    await removeAttemptFolder(dir)
    throw error
  }
}

/** Gives the CLI the address the browser ended on; resolves to its refusal, or null once taken. */
export async function submitSealConnectorRedirect(
  attemptId: string,
  url: string
): Promise<string | null> {
  const attempt = attempts.get(attemptId)
  if (!attempt?.sessionId || attempt.cancelled) {
    return 'This sign-in has ended; start it again'
  }
  return submitConnectorRedirect(attempt.sessionId, url)
}

export function waitForSealConnectorSignIn(attemptId: string): Promise<SealConnectorsSignInResult> {
  const outcome = attempts.get(attemptId)?.outcome
  return outcome ?? Promise.resolve(failed('This sign-in has ended; start it again'))
}

export function cancelSealConnectorSignIn(attemptId: string): void {
  const attempt = attempts.get(attemptId)
  if (!attempt) {
    return
  }
  attempt.cancelled = true
  if (attempt.sessionId) {
    cancelConnectorSignIn(attempt.sessionId)
  }
}

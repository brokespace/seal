import { joinMachinePath } from '../../shared/machines/machine-paths'
import type { SealAccountsImportCredential } from '../../shared/rpc-contract/seal-accounts-params'
import { credentialFreshness } from '../../shared/seal-accounts/seal-credential-freshness'
import type { MachineConnection } from '../machines/connection/machine-connection'
import { quoteForMachineShell } from '../machines/work/machine-worktrees'

const MAX_LOGIN_FILE_BYTES = 4 * 1024 * 1024
// Claude Code on macOS reads its login from this Keychain item, not from a file.
const CLAUDE_KEYCHAIN_SERVICE = 'Claude Code-credentials'

async function readOptional(connection: MachineConnection, path: string): Promise<string | null> {
  try {
    const { size, data } = await connection.files.readFile(path, MAX_LOGIN_FILE_BYTES)
    return size > data.length ? null : data.toString('utf8')
  } catch {
    return null
  }
}

async function writePrivate(
  connection: MachineConnection,
  dir: string,
  path: string,
  content: string
): Promise<void> {
  await connection.files.createDir(dir).catch(() => {})
  await connection.files.writeFile(path, Buffer.from(content, 'utf8'))
  if ((await connection.dialect()) === 'posix') {
    await connection.exec(`chmod 600 ${quoteForMachineShell(path, 'posix')}`, { timeoutMs: 15_000 })
  }
}

/** An older push must never undo a refresh the host already made. */
function isNewer(provider: 'claude' | 'codex', incoming: string, current: string | null): boolean {
  if (current === null) {
    return true
  }
  return (
    (credentialFreshness(provider, incoming) ?? -1) > (credentialFreshness(provider, current) ?? -1)
  )
}

async function installClaudeOnMac(
  connection: MachineConnection,
  credentialsJson: string
): Promise<void> {
  const result = await connection.exec(
    `security add-generic-password -U -a "$USER" -s ${quoteForMachineShell(CLAUDE_KEYCHAIN_SERVICE, 'posix')} -w "$(cat)"`,
    { timeoutMs: 20_000, stdin: credentialsJson }
  )
  if (result.exitCode !== 0) {
    throw new Error(
      `The Mac's login Keychain refused the Claude login (unlock it, or sign in on the Mac): ${result.stderr.trim()}`
    )
  }
}

/**
 * Makes a pushed login the machine's own CLI login, written through its connection. Machines
 * without a resident Seal have no account vault, so the login lands where the CLI reads it.
 */
export async function installLoginOnMachine(
  connection: MachineConnection,
  credential: SealAccountsImportCredential
): Promise<void> {
  await connection.connect()
  const home = await connection.files.homeDir()
  if (credential.provider === 'codex') {
    const dir = joinMachinePath(home, '.codex')
    const path = joinMachinePath(dir, 'auth.json')
    if (isNewer('codex', credential.authJson, await readOptional(connection, path))) {
      await writePrivate(connection, dir, path, credential.authJson)
    }
    return
  }
  const metrics = await connection.metrics()
  if (metrics.os === 'darwin') {
    await installClaudeOnMac(connection, credential.credentialsJson)
  } else {
    const dir = joinMachinePath(home, '.claude')
    const path = joinMachinePath(dir, '.credentials.json')
    if (!isNewer('claude', credential.credentialsJson, await readOptional(connection, path))) {
      return
    }
    await writePrivate(connection, dir, path, credential.credentialsJson)
  }
  const statePath = joinMachinePath(home, '.claude.json')
  const raw = await readOptional(connection, statePath)
  let state: Record<string, unknown> = {}
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : {}
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      state = { ...parsed }
    }
  } catch {
    // A corrupt state file is rewritten with just the account block Claude needs.
  }
  state.oauthAccount = JSON.parse(credential.oauthAccountJson)
  await writePrivate(connection, home, statePath, `${JSON.stringify(state, null, 2)}\n`)
}

import { createHash } from 'node:crypto'
import type {
  AgentConfigDocument,
  AgentConfigIssue,
  AgentConfigValidationKind,
  AgentConfigWriteResult
} from '../../shared/agent-config/agent-config-types'
import {
  validateAgentConfigContent,
  validationKindForPath
} from '../../shared/agent-config/agent-config-validation'
import { machinePathBasename, machinePathDirname } from '../../shared/machines/machine-paths'
import { quotePosixShell } from '../../shared/shell/launch/shell-argument-quoting'
import type { MachineConnection } from '../machines/connection/machine-connection'
import { scanMachineFiles, type MachineFileScanRunner } from '../machines/scan/machine-file-scan'
import { backupFile, backupStamp } from './agent-config-backups'

/** `~/.claude.json` grows with every project Claude Code has seen; this still fits it. */
const MAX_CONFIG_BYTES = 48 * 1024 * 1024
const EXEC_TIMEOUT_MS = 30_000

export class AgentConfigValidationError extends Error {
  constructor(readonly issues: AgentConfigIssue[]) {
    super(issues.map((issue) => issue.message).join('. '))
    this.name = 'AgentConfigValidationError'
  }
}

export function contentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

export async function scanRunner(connection: MachineConnection): Promise<MachineFileScanRunner> {
  return {
    dialect: await connection.dialect(),
    exec: (script, options) => connection.exec(script, options)
  }
}

export type PathState = 'file' | 'directory' | 'missing'

/**
 * Whether paths exist, asked in a way that cannot mistake a dropped connection for "missing":
 * a file wrongly taken for absent would be written from scratch and lose everything in it.
 */
export async function pathStates(
  connection: MachineConnection,
  paths: readonly string[]
): Promise<{ home: string; states: Map<string, PathState> }> {
  const scan = await scanMachineFiles(await scanRunner(connection), {
    files: paths.map((path, index) => ({ tag: String(index), path })),
    dirs: paths.map((path, index) => ({ tag: String(index), path })),
    headBytes: 0
  })
  const states = new Map<string, PathState>(paths.map((path) => [path, 'missing']))
  const found = (tag: string, state: PathState): void => {
    const path = paths[Number(tag)]
    if (path !== undefined) {
      states.set(path, state)
    }
  }
  for (const record of scan.records) {
    found(record.tag, 'file')
  }
  for (const dir of scan.dirs) {
    found(dir.tag, 'directory')
  }
  return { home: scan.home, states }
}

type ReadFile = AgentConfigDocument & { home: string; data: Buffer | null }

async function readBytes(connection: MachineConnection, path: string): Promise<Buffer> {
  const read = await connection.files.readFile(path, MAX_CONFIG_BYTES)
  if (read.size > read.data.length) {
    throw new Error(`${path} is too large to edit here`)
  }
  return read.data
}

/** The file as it is on the machine right now; a missing file reads as empty. */
export async function readConfigFile(
  connection: MachineConnection,
  path: string
): Promise<ReadFile> {
  const { home, states } = await pathStates(connection, [path])
  const state = states.get(path)
  if (state === 'directory') {
    throw new Error(`${path} is a folder`)
  }
  if (state === 'missing') {
    return { path, content: '', hash: contentHash(''), exists: false, home, data: null }
  }
  const data = await readBytes(connection, path)
  const content = data.toString('utf8')
  return { path, content, hash: contentHash(content), exists: true, home, data }
}

export type WriteOptions = {
  /** Hash of the content the edit was based on; a different file on disk stops the write. */
  expectedHash?: string
  /** The check to run; defaults to the one the path calls for. */
  validation?: AgentConfigValidationKind
  /** Folder or file name a document's declared name should match. */
  expectedName?: string
  /** New files that may hold tokens are made readable by this account only. */
  private?: boolean
  /** Refuse to replace an existing file. */
  mustBeNew?: boolean
}

function requireValid(path: string, content: string, options: WriteOptions): void {
  const byPath = validationKindForPath(path)
  const kinds = new Set([options.validation ?? byPath])
  // Whatever the caller asked for, a file an agent parses must still parse.
  if (byPath !== 'text' && byPath !== 'skill' && byPath !== 'subagent') {
    kinds.add(byPath)
  }
  const errors = [...kinds]
    .flatMap((kind) => validateAgentConfigContent(kind, content, options.expectedName))
    .filter((issue) => issue.severity === 'error')
  if (errors.length > 0) {
    throw new AgentConfigValidationError(errors)
  }
}

/**
 * The one way Seal changes a config file: validate, compare with what is on disk, copy the old
 * bytes to the backups folder, write in place (symlinks and file modes survive), then read back.
 */
export async function writeConfigFile(
  connection: MachineConnection,
  path: string,
  content: string,
  options: WriteOptions = {}
): Promise<AgentConfigWriteResult> {
  requireValid(path, content, options)
  const current = await readConfigFile(connection, path)
  if (options.mustBeNew && current.exists) {
    throw new Error(`${machinePathBasename(path)} already exists`)
  }
  if (options.expectedHash !== undefined && options.expectedHash !== current.hash) {
    throw new Error(
      `${machinePathBasename(path)} changed on the machine after you opened it. Reload it, then make your change again.`
    )
  }
  if (current.exists && current.content === content) {
    return { path, hash: current.hash, backupPath: null }
  }
  const backupPath = current.data
    ? await backupFile(connection, current.home, path, current.data, backupStamp())
    : null
  const parent = machinePathDirname(path)
  if (parent) {
    await connection.files.createDir(parent)
  }
  const data = Buffer.from(content, 'utf8')
  await connection.files.writeFile(path, data)
  const written = await readBytes(connection, path)
  if (!written.equals(data)) {
    if (current.data) {
      await connection.files.writeFile(path, current.data).catch(() => {})
    }
    throw new Error(
      `${machinePathBasename(path)} did not read back as written${backupPath ? `; the previous version is at ${backupPath}` : ''}`
    )
  }
  if (!current.exists && options.private && (await connection.dialect()) === 'posix') {
    await connection
      .exec(`chmod 600 ${quotePosixShell(path)}`, { timeoutMs: EXEC_TIMEOUT_MS })
      .catch(() => {})
  }
  return { path, hash: contentHash(content), backupPath }
}

import type { MachineWorktree } from '../../../shared/machines/machine-view'
import type { MachineConnection, MachineShellDialect } from '../connection/machine-connection'

const GIT_TIMEOUT_MS = 60_000

export function quoteForMachineShell(value: string, dialect: MachineShellDialect): string {
  return dialect === 'powershell'
    ? `'${value.replaceAll("'", "''")}'`
    : `'${value.replaceAll("'", `'\\''`)}'`
}

function gitCommand(dialect: MachineShellDialect, repoPath: string, args: string[]): string {
  const quoted = [repoPath, ...args].map((arg) => quoteForMachineShell(arg, dialect))
  // PowerShell needs the call operator to run a command whose arguments follow a quoted string.
  return `${dialect === 'powershell' ? '& ' : ''}git -C ${quoted.join(' ')}`
}

async function runGit(
  connection: MachineConnection,
  repoPath: string,
  args: string[]
): Promise<string> {
  const dialect = await connection.dialect()
  const result = await connection.exec(gitCommand(dialect, repoPath, args), {
    timeoutMs: GIT_TIMEOUT_MS
  })
  if (result.timedOut) {
    throw new Error('git timed out on this machine')
  }
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || `git exited with ${result.exitCode}`)
  }
  return result.stdout
}

export function parseWorktreePorcelain(output: string): MachineWorktree[] {
  const worktrees: MachineWorktree[] = []
  let current: MachineWorktree | null = null
  for (const line of output.split(/\r?\n/)) {
    if (line.startsWith('worktree ')) {
      current = { path: line.slice('worktree '.length), branch: null, head: null, bare: false }
      worktrees.push(current)
    } else if (current && line.startsWith('HEAD ')) {
      current.head = line.slice('HEAD '.length)
    } else if (current && line.startsWith('branch ')) {
      current.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '')
    } else if (current && line === 'bare') {
      current.bare = true
    }
  }
  return worktrees
}

export async function listMachineWorktrees(
  connection: MachineConnection,
  repoPath: string
): Promise<MachineWorktree[]> {
  return parseWorktreePorcelain(
    await runGit(connection, repoPath, ['worktree', 'list', '--porcelain'])
  )
}

/** Adds a worktree on a new branch, or checks out the branch when it already exists. */
export async function createMachineWorktree(
  connection: MachineConnection,
  args: { repoPath: string; path: string; branch: string; base?: string }
): Promise<MachineWorktree[]> {
  const branches = await runGit(connection, args.repoPath, [
    'branch',
    '--list',
    '--format=%(refname:short)',
    args.branch
  ])
  const exists = branches.split(/\r?\n/).some((line) => line.trim() === args.branch)
  await runGit(
    connection,
    args.repoPath,
    exists
      ? ['worktree', 'add', args.path, args.branch]
      : ['worktree', 'add', '-b', args.branch, args.path, ...(args.base ? [args.base] : [])]
  )
  return listMachineWorktrees(connection, args.repoPath)
}

/**
 * `force` discards uncommitted work; `unlock` also overrides Git's lock (`remove -f -f`). Each is
 * the user's answer to a refusal Git gave, so neither is ever sent on a first attempt.
 */
export async function removeMachineWorktree(
  connection: MachineConnection,
  args: { repoPath: string; path: string; force?: boolean; unlock?: boolean }
): Promise<MachineWorktree[]> {
  const waivers = args.unlock ? ['--force', '--force'] : args.force ? ['--force'] : []
  await runGit(connection, args.repoPath, ['worktree', 'remove', ...waivers, args.path])
  return listMachineWorktrees(connection, args.repoPath)
}

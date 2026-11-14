import { quotePosixShell } from '../../../shared/shell/launch/shell-argument-quoting'
import type { MachineShellDialect } from '../connection/machine-connection'

/** Paths may start with `~/` for the account's home folder; found files come back absolute. */
export type MachineFileScanRequest = {
  /** Single files, reported when they exist. */
  files?: { tag: string; path: string }[]
  /** Folders of skills: every `<dir>/<name>/SKILL.md`. */
  skillRoots?: { tag: string; dir: string }[]
  /** Every file with this extension under a folder. */
  trees?: { tag: string; dir: string; extension: string; recursive: boolean }[]
  /** Files with one of these names anywhere under a folder, to a depth, skipping some folders. */
  named?: { tag: string; root: string; names: string[]; maxDepth: number; skipDirs: string[] }[]
  /** Folders, reported when they exist. */
  dirs?: { tag: string; path: string }[]
  /** Programs, reported when they are on the login PATH. */
  commands?: string[]
  /** How much of each file's start to return. */
  headBytes: number
}

export type MachineFileScanRecord = { tag: string; path: string; bytes: number; head: string }

export type MachineFileScanResult = {
  /** Null when the output held no report at all: the script did not run to the end. */
  home: string | null
  commands: string[]
  dirs: { tag: string; path: string }[]
  records: MachineFileScanRecord[]
}

const RECORD = '\u001e'
const FIELD = '\u001f'
const HOME_TAG = '@home'
const COMMAND_TAG = '@command'
const DIR_TAG = '@dir:'
const MAX_TREE_FILES = 400
const MAX_TREE_DEPTH = 8

function posixWord(path: string): string {
  if (path === '~') {
    return '"$HOME"'
  }
  return path.startsWith('~/') ? `"$HOME"/${quotePosixShell(path.slice(2))}` : quotePosixShell(path)
}

function posixScript(request: MachineFileScanRequest): string {
  const each = (find: string, tag: string): string =>
    `${find} 2>/dev/null | sort | head -n ${MAX_TREE_FILES} | while IFS= read -r f; do emit ${quotePosixShell(tag)} "$f"; done`
  return [
    `emit() { [ -f "$2" ] || return 0; printf '\\036%s\\037%s\\037%s\\037' "$1" "$2" "$(wc -c < "$2" | tr -d ' ')"; head -c ${request.headBytes} "$2"; }`,
    `mark() { printf '\\036%s\\037%s\\0370\\037' "$1" "$2"; }`,
    `mark ${quotePosixShell(HOME_TAG)} "$HOME"`,
    ...(request.commands ?? []).map(
      (command) =>
        `command -v ${quotePosixShell(command)} >/dev/null 2>&1 && mark ${quotePosixShell(COMMAND_TAG)} ${quotePosixShell(command)}`
    ),
    ...(request.dirs ?? []).map(
      ({ tag, path }) =>
        `[ -d ${posixWord(path)} ] && mark ${quotePosixShell(`${DIR_TAG}${tag}`)} ${posixWord(path)}`
    ),
    ...(request.skillRoots ?? []).map(
      ({ tag, dir }) =>
        `for f in ${posixWord(dir)}/*/SKILL.md; do emit ${quotePosixShell(tag)} "$f"; done`
    ),
    ...(request.trees ?? []).map(({ tag, dir, extension, recursive }) =>
      each(
        // -L: dotfile managers link these folders in from elsewhere.
        `[ -d ${posixWord(dir)} ] && find -L ${posixWord(dir)} -maxdepth ${recursive ? MAX_TREE_DEPTH : 1} -type f -name ${quotePosixShell(`*${extension}`)}`,
        tag
      )
    ),
    ...(request.named ?? []).map(({ tag, root, names, maxDepth, skipDirs }) => {
      const prune = skipDirs.map((name) => `-name ${quotePosixShell(name)}`).join(' -o ')
      const wanted = names.map((name) => `-name ${quotePosixShell(name)}`).join(' -o ')
      return each(
        `[ -d ${posixWord(root)} ] && find ${posixWord(root)} -maxdepth ${maxDepth} ${prune ? `-type d \\( ${prune} \\) -prune -o ` : ''}-type f \\( ${wanted} \\) -print`,
        tag
      )
    }),
    ...(request.files ?? []).map(
      ({ tag, path }) => `emit ${quotePosixShell(tag)} ${posixWord(path)}`
    ),
    'exit 0'
  ].join('\n')
}

function powerShellLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

function powerShellPath(path: string): string {
  const windows = path.replaceAll('/', '\\')
  if (windows === '~') {
    return '$h'
  }
  return windows.startsWith('~\\')
    ? `(Join-Path $h ${powerShellLiteral(windows.slice(2))})`
    : powerShellLiteral(windows)
}

function powerShellScript(request: MachineFileScanRequest): string {
  const list = (values: readonly string[]): string =>
    `@(${values.map(powerShellLiteral).join(', ')})`
  return [
    "$ErrorActionPreference = 'SilentlyContinue'",
    '$h = $env:USERPROFILE',
    'function Mark($tag, $value) { [Console]::Out.Write([string][char]30 + $tag + [char]31 + $value + [char]31 + "0" + [char]31) }',
    'function Emit($tag, $path) {',
    '  if (Test-Path -LiteralPath $path -PathType Leaf) {',
    '    $bytes = [IO.File]::ReadAllBytes($path)',
    `    $head = [Text.Encoding]::UTF8.GetString($bytes, 0, [Math]::Min($bytes.Length, ${request.headBytes}))`,
    '    [Console]::Out.Write([string][char]30 + $tag + [char]31 + $path + [char]31 + $bytes.Length + [char]31 + $head)',
    '  }',
    '}',
    `Mark ${powerShellLiteral(HOME_TAG)} $h`,
    ...(request.commands ?? []).map(
      (command) =>
        `if (Get-Command ${powerShellLiteral(command)}) { Mark ${powerShellLiteral(COMMAND_TAG)} ${powerShellLiteral(command)} }`
    ),
    ...(request.dirs ?? []).map(
      ({ tag, path }) =>
        `if (Test-Path -LiteralPath ${powerShellPath(path)} -PathType Container) { Mark ${powerShellLiteral(`${DIR_TAG}${tag}`)} ${powerShellPath(path)} }`
    ),
    ...(request.skillRoots ?? []).map(
      ({ tag, dir }) =>
        `if (Test-Path -LiteralPath ${powerShellPath(dir)}) { Get-ChildItem -LiteralPath ${powerShellPath(dir)} -Directory | Sort-Object Name | ForEach-Object { Emit ${powerShellLiteral(tag)} (Join-Path $_.FullName 'SKILL.md') } }`
    ),
    ...(request.trees ?? []).map(
      ({ tag, dir, extension, recursive }) =>
        `if (Test-Path -LiteralPath ${powerShellPath(dir)}) { Get-ChildItem -LiteralPath ${powerShellPath(dir)} -File ${recursive ? `-Recurse -Depth ${MAX_TREE_DEPTH} ` : ''}-Filter ${powerShellLiteral(`*${extension}`)} | Sort-Object FullName | Select-Object -First ${MAX_TREE_FILES} | ForEach-Object { Emit ${powerShellLiteral(tag)} $_.FullName } }`
    ),
    ...(request.named ?? []).map(
      ({ tag, root, names, maxDepth, skipDirs }) =>
        `if (Test-Path -LiteralPath ${powerShellPath(root)}) { $skip = ${list(skipDirs)}; Get-ChildItem -LiteralPath ${powerShellPath(root)} -File -Recurse -Depth ${maxDepth} | Where-Object { ${list(names)} -contains $_.Name -and -not ($_.FullName.Split([IO.Path]::DirectorySeparatorChar) | Where-Object { $skip -contains $_ }) } | Sort-Object FullName | Select-Object -First ${MAX_TREE_FILES} | ForEach-Object { Emit ${powerShellLiteral(tag)} $_.FullName } }`
    ),
    ...(request.files ?? []).map(
      ({ tag, path }) => `Emit ${powerShellLiteral(tag)} ${powerShellPath(path)}`
    )
  ].join('\n')
}

/** One script that reports everything asked for, so a slow link pays for one round trip. */
export function machineFileScanScript(
  dialect: MachineShellDialect,
  request: MachineFileScanRequest
): string {
  return dialect === 'powershell' ? powerShellScript(request) : posixScript(request)
}

export function parseMachineFileScan(stdout: string): MachineFileScanResult {
  const result: MachineFileScanResult = { home: null, commands: [], dirs: [], records: [] }
  for (const record of stdout.split(RECORD).slice(1)) {
    const [tag, rawPath, bytes, ...head] = record.split(FIELD)
    if (!tag || rawPath === undefined) {
      continue
    }
    // `find dir/` and `"$root"/*` can leave a doubled slash behind.
    const path = rawPath.replace(/(?<=[^/])\/{2,}/g, '/')
    if (tag === HOME_TAG) {
      result.home = path
    } else if (tag === COMMAND_TAG) {
      result.commands.push(path)
    } else if (tag.startsWith(DIR_TAG)) {
      result.dirs.push({ tag: tag.slice(DIR_TAG.length), path })
    } else {
      result.records.push({
        tag,
        path,
        bytes: Number.parseInt(bytes ?? '', 10) || 0,
        head: head.join(FIELD)
      })
    }
  }
  return result
}

export type MachineFileScanRunner = {
  dialect: MachineShellDialect
  exec: (
    script: string,
    options: { timeoutMs: number }
  ) => Promise<{ exitCode: number | null; stdout: string; stderr: string }>
}

/** Runs a scan and fails loudly when the machine did not answer, so "nothing there" is trustworthy. */
export async function scanMachineFiles(
  machine: MachineFileScanRunner,
  request: MachineFileScanRequest,
  timeoutMs = 30_000
): Promise<MachineFileScanResult & { home: string }> {
  const output = await machine.exec(machineFileScanScript(machine.dialect, request), { timeoutMs })
  const result = parseMachineFileScan(output.stdout)
  if (result.home === null) {
    throw new Error(output.stderr.trim() || 'The machine did not answer the file scan')
  }
  return { ...result, home: result.home }
}

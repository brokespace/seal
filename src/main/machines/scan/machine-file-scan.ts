import { quotePosixShell } from '../../../shared/shell/launch/shell-argument-quoting'
import type { MachineShellDialect } from '../connection/machine-connection'

/** Paths may start with `~/` for the account's home folder; found files come back absolute. */
export type MachineFileScanRequest = {
  /** Single files, reported when they exist. */
  files?: { tag: string; path: string }[]
  /**
   * Folders of skills: every `SKILL.md` from `minDepth` to `maxDepth` folders below `dir`
   * (`<dir>/<name>/SKILL.md` is 1, the default for both). Linked folders are followed.
   */
  skillRoots?: { tag: string; dir: string; minDepth?: number; maxDepth?: number }[]
  /** Every file with this extension under a folder. */
  trees?: { tag: string; dir: string; extension: string; recursive: boolean }[]
  /** Files with one of these names anywhere under a folder, to a depth, skipping some folders. */
  named?: {
    tag: string
    root: string
    names: string[]
    maxDepth: number
    skipDirs: string[]
    /** Walk into linked folders, and into the root when it is a link itself. */
    followLinks?: boolean
    /** Look inside folders Windows marks hidden as well. */
    includeHidden?: boolean
  }[]
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
  /** False when the start or the end of the answer is missing: a transport keeps about 1 MiB. */
  complete: boolean
  /** Tags of the folders that hold more files than a scan reports. */
  capped: string[]
  commands: string[]
  dirs: { tag: string; path: string }[]
  records: MachineFileScanRecord[]
}

const RECORD = '\u001e'
const FIELD = '\u001f'
const HOME_TAG = '@home'
const END_TAG = '@end'
const MORE_TAG = '@more'
/** Short enough that some 900 files fit in the 1 MiB an SSH or server exec carries back. */
const SHORT_HEAD_BYTES = 1_024
const COMMAND_TAG = '@command'
const DIR_TAG = '@dir:'
export const MACHINE_SCAN_MAX_TREE_FILES = 400
const MAX_TREE_DEPTH = 8
const SKILL_FILE = 'SKILL.md'
/** Folders inside a skills folder or a plugin that are someone else's tree, never a skill. */
export const SKILL_SCAN_SKIP_DIRS = ['node_modules', '.git']

function posixWord(path: string): string {
  if (path === '~') {
    return '"$HOME"'
  }
  return path.startsWith('~/') ? `"$HOME"/${quotePosixShell(path.slice(2))}` : quotePosixShell(path)
}

function posixScript(request: MachineFileScanRequest): string {
  const each = (find: string, tag: string): string =>
    `${find} 2>/dev/null | sort | head -n ${MACHINE_SCAN_MAX_TREE_FILES + 1} | { n=0; while IFS= read -r f; do n=$((n + 1)); if [ "$n" -gt ${MACHINE_SCAN_MAX_TREE_FILES} ]; then mark ${quotePosixShell(MORE_TAG)} ${quotePosixShell(tag)}; else emit ${quotePosixShell(tag)} "$f"; fi; done; }`
  return [
    `emit() { [ -f "$2" ] || return 0; printf '\\036%s\\037%s\\037%s\\037' "$1" "$2" "$(wc -c < "$2" | tr -d ' ')"; head -c ${request.headBytes} "$2" | LC_ALL=C tr -d '\\036\\037'; }`,
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
    ...(request.skillRoots ?? []).map(({ tag, dir, minDepth = 1, maxDepth = 1 }) =>
      each(
        // -L: skills are often links into a dotfiles repository or another agent's folder.
        `[ -d ${posixWord(dir)} ] && find -L ${posixWord(dir)} -mindepth ${minDepth + 1} -maxdepth ${maxDepth + 1} -type d \\( ${SKILL_SCAN_SKIP_DIRS.map((name) => `-name ${quotePosixShell(name)}`).join(' -o ')} \\) -prune -o -type f -name ${quotePosixShell(SKILL_FILE)} -print`,
        tag
      )
    ),
    ...(request.trees ?? []).map(({ tag, dir, extension, recursive }) =>
      each(
        // -L: dotfile managers link these folders in from elsewhere.
        `[ -d ${posixWord(dir)} ] && find -L ${posixWord(dir)} -maxdepth ${recursive ? MAX_TREE_DEPTH : 1} -type f -name ${quotePosixShell(`*${extension}`)}`,
        tag
      )
    ),
    ...(request.named ?? []).map(({ tag, root, names, maxDepth, skipDirs, followLinks }) => {
      const prune = skipDirs.map((name) => `-name ${quotePosixShell(name)}`).join(' -o ')
      const wanted = names.map((name) => `-name ${quotePosixShell(name)}`).join(' -o ')
      return each(
        `[ -d ${posixWord(root)} ] && find ${followLinks ? '-L ' : ''}${posixWord(root)} -maxdepth ${maxDepth} ${prune ? `-type d \\( ${prune} \\) -prune -o ` : ''}-type f \\( ${wanted} \\) -print`,
        tag
      )
    }),
    ...(request.files ?? []).map(
      ({ tag, path }) => `emit ${quotePosixShell(tag)} ${posixWord(path)}`
    ),
    `mark ${quotePosixShell(END_TAG)} "$HOME"`,
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
    // Windows PowerShell answers in the console's code page, which mangles non-ASCII names.
    '[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false',
    '$h = $env:USERPROFILE',
    // Windows PowerShell 5 walks into linked folders by itself; PowerShell 6+ has to be asked.
    '$links = @{}; if ($PSVersionTable.PSVersion.Major -ge 6) { $links.FollowSymlink = $true }',
    "function Below($root, $path) { ($path.Substring($root.Length).Trim([char]92, [char]47) -split '[\\\\/]').Count - 1 }",
    // Only folders below the root count: the root may itself sit inside a node_modules.
    "function Skipped($root, $path, $skip) { [bool]($path.Substring($root.Length) -split '[\\\\/]' | Where-Object { $skip -contains $_ }) }",
    'function Mark($tag, $value) { [Console]::Out.Write([string][char]30 + $tag + [char]31 + $value + [char]31 + "0" + [char]31) }',
    'function Emit($tag, $path) {',
    '  if (Test-Path -LiteralPath $path -PathType Leaf) {',
    '    $bytes = [IO.File]::ReadAllBytes($path)',
    // A file holding the separators themselves would otherwise read as extra records.
    `    $head = [Text.Encoding]::UTF8.GetString($bytes, 0, [Math]::Min($bytes.Length, ${request.headBytes})).Replace([string][char]30, '').Replace([string][char]31, '')`,
    '    [Console]::Out.Write([string][char]30 + $tag + [char]31 + $path + [char]31 + $bytes.Length + [char]31 + $head)',
    '  }',
    '}',
    // One past the limit is reported as a mark, so a folder that holds more is known to.
    `function Report($tag) { $n = 0; $input | Sort-Object FullName | Select-Object -First ${MACHINE_SCAN_MAX_TREE_FILES + 1} | ForEach-Object { $n++; if ($n -gt ${MACHINE_SCAN_MAX_TREE_FILES}) { Mark ${powerShellLiteral(MORE_TAG)} $tag } else { Emit $tag $_.FullName } } }`,
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
      ({ tag, dir, minDepth = 1, maxDepth = 1 }) =>
        `$root = ${powerShellPath(dir)}; if (Test-Path -LiteralPath $root -PathType Container) { $skip = ${list(SKILL_SCAN_SKIP_DIRS)}; Get-ChildItem -LiteralPath $root -File -Force -Recurse -Depth ${maxDepth} @links -Filter ${powerShellLiteral(SKILL_FILE)} | Where-Object { (Below $root $_.FullName) -ge ${minDepth} -and -not (Skipped $root $_.FullName $skip) } | Report ${powerShellLiteral(tag)} }`
    ),
    ...(request.trees ?? []).map(
      ({ tag, dir, extension, recursive }) =>
        `if (Test-Path -LiteralPath ${powerShellPath(dir)}) { Get-ChildItem -LiteralPath ${powerShellPath(dir)} -File ${recursive ? `-Recurse -Depth ${MAX_TREE_DEPTH} ` : ''}-Filter ${powerShellLiteral(`*${extension}`)} | Report ${powerShellLiteral(tag)} }`
    ),
    ...(request.named ?? []).map(
      ({ tag, root, names, maxDepth, skipDirs, followLinks, includeHidden }) =>
        `$root = ${powerShellPath(root)}; if (Test-Path -LiteralPath $root) { $skip = ${list(skipDirs)}; Get-ChildItem -LiteralPath $root -File ${includeHidden ? '-Force ' : ''}-Recurse -Depth ${maxDepth - 1} ${followLinks ? '@links ' : ''}| Where-Object { ${list(names)} -contains $_.Name -and -not (Skipped $root $_.FullName $skip) } | Report ${powerShellLiteral(tag)} }`
    ),
    ...(request.files ?? []).map(
      ({ tag, path }) => `Emit ${powerShellLiteral(tag)} ${powerShellPath(path)}`
    ),
    `Mark ${powerShellLiteral(END_TAG)} $h`
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
  const result: MachineFileScanResult = {
    home: null,
    complete: false,
    capped: [],
    commands: [],
    dirs: [],
    records: []
  }
  let started = false
  let ended = false
  for (const record of stdout.split(RECORD).slice(1)) {
    const [tag, rawPath, bytes, ...head] = record.split(FIELD)
    if (!tag || rawPath === undefined) {
      continue
    }
    // `find dir/` and `"$root"/*` can leave a doubled slash behind.
    const path = rawPath.replace(/(?<=[^/])\/{2,}/g, '/')
    if (tag === HOME_TAG) {
      result.home = path
      started = true
    } else if (tag === END_TAG) {
      // The home again, for an answer that lost its start.
      result.home ??= path
      ended = true
    } else if (tag === MORE_TAG) {
      result.capped.push(path)
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
  if (!ended) {
    // The answer stops in the middle of the last file.
    result.records.pop()
  }
  result.complete = started && ended
  return result
}

type MachineFileScanExec = (
  script: string,
  options: { timeoutMs: number }
) => Promise<{ exitCode: number | null; stdout: string; stderr: string }>

export type MachineFileScanRunner = {
  dialect: MachineShellDialect
  exec: MachineFileScanExec
  /** Used when the scan looks for commands, so the login shell's PATH is searched. */
  execLogin?: MachineFileScanExec
}

/** Runs a scan and fails loudly when the machine did not answer, so "nothing there" is trustworthy. */
export async function scanMachineFiles(
  machine: MachineFileScanRunner,
  request: MachineFileScanRequest,
  timeoutMs = 30_000
): Promise<MachineFileScanResult & { home: string }> {
  const run = request.commands?.length && machine.execLogin ? machine.execLogin : machine.exec
  const output = await run(machineFileScanScript(machine.dialect, request), { timeoutMs })
  const result = parseMachineFileScan(output.stdout)
  if (result.home === null) {
    throw new Error(output.stderr.trim() || 'The machine did not answer the file scan')
  }
  return { ...result, home: result.home }
}

/** A scan whose answer was cut is asked again with shorter file starts, so more files fit. */
export async function scanMachineFilesInFull(
  machine: MachineFileScanRunner,
  request: MachineFileScanRequest
): Promise<MachineFileScanResult & { home: string; headBytes: number }> {
  const scan = await scanMachineFiles(machine, request)
  if (scan.complete || request.headBytes <= SHORT_HEAD_BYTES) {
    return { ...scan, headBytes: request.headBytes }
  }
  const short = await scanMachineFiles(machine, { ...request, headBytes: SHORT_HEAD_BYTES })
  return { ...short, headBytes: SHORT_HEAD_BYTES }
}

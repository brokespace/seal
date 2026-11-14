import { quotePosixShell } from '../../../shared/shell/launch/shell-argument-quoting'
import type { MachineFileEntry, MachineFileKind } from '../../../shared/machines/machine-types'

const LIST_FIELD_SEPARATOR = '/'

/**
 * Lists one folder with type/size/mtime in a single process: GNU stat first, BSD stat second.
 * `/` separates fields because it is the one byte a file name cannot contain.
 */
export function posixListDirCommand(dir: string): string {
  const globs = '.[!.]* ..?* *'
  return [
    `cd ${quotePosixShell(dir)} || exit 1`,
    `set -- ${globs}`,
    'files=""',
    'for f in "$@"; do if [ -e "$f" ] || [ -L "$f" ]; then files=1; break; fi; done',
    '[ -z "$files" ] && exit 0',
    // Unmatched globs stay literal; stat reports them on stderr and lists the rest.
    `if stat -c '%F/%s/%Y/%n' -- . >/dev/null 2>&1; then stat -c '%F/%s/%Y/%n' -- "$@" 2>/dev/null`,
    `else stat -f '%HT/%z/%m/%N' -- "$@" 2>/dev/null; fi`,
    'for f in "$@"; do if [ -L "$f" ] && [ -d "$f" ]; then printf \'L/0/0/%s\\n\' "$f"; fi; done',
    'exit 0'
  ].join('\n')
}

function kindFromStatType(type: string): MachineFileKind {
  const normalized = type.trim().toLowerCase()
  if (normalized.includes('directory')) {
    return 'directory'
  }
  if (normalized.includes('symbolic link')) {
    return 'symlink'
  }
  if (normalized.includes('regular')) {
    return 'file'
  }
  return 'other'
}

/** Parses `posixListDirCommand` output; trailing `L` lines mark symlinks that resolve to folders. */
export function parsePosixListDirOutput(output: string): MachineFileEntry[] {
  const entries = new Map<string, MachineFileEntry>()
  const symlinkDirs = new Set<string>()
  for (const line of output.split('\n')) {
    if (!line) {
      continue
    }
    const parts = line.split(LIST_FIELD_SEPARATOR)
    if (parts.length < 4) {
      continue
    }
    const [type, size, mtime] = parts
    const name = parts.slice(3).join(LIST_FIELD_SEPARATOR)
    if (!name || name === '.' || name === '..') {
      continue
    }
    if (type === 'L') {
      symlinkDirs.add(name)
      continue
    }
    const kind = kindFromStatType(type)
    entries.set(name, {
      name,
      kind,
      isDirectoryLike: kind === 'directory',
      size: Number(size) || 0,
      mtimeMs: (Number(mtime) || 0) * 1000
    })
  }
  for (const name of symlinkDirs) {
    const entry = entries.get(name)
    if (entry) {
      entry.isDirectoryLike = true
    }
  }
  return [...entries.values()]
}

export function posixStatCommand(path: string): string {
  const quoted = quotePosixShell(path)
  return [
    `if stat -c '%F/%s/%Y/%n' -- ${quoted} >/dev/null 2>&1; then stat -c '%F/%s/%Y/%n' -- ${quoted};`,
    `else stat -f '%HT/%z/%m/%N' -- ${quoted}; fi`,
    `if [ -L ${quoted} ] && [ -d ${quoted} ]; then printf 'L/0/0/%s\\n' ${quoted}; fi`
  ].join('\n')
}

export function posixMkdirCommand(path: string): string {
  return `mkdir -p -- ${quotePosixShell(path)}`
}

export function posixRenameCommand(from: string, to: string): string {
  // -n refuses to clobber an existing name; the explicit test covers mv builds without -n.
  return `[ -e ${quotePosixShell(to)} ] && { echo "Destination already exists" >&2; exit 1; }; mv -n -- ${quotePosixShell(from)} ${quotePosixShell(to)}`
}

export function posixRemoveCommand(path: string): string {
  return `rm -rf -- ${quotePosixShell(path)}`
}

/** curl first, wget second; prints nothing on success. */
export function posixDownloadUrlCommand(url: string, destination: string): string {
  const quotedUrl = quotePosixShell(url)
  const quotedDest = quotePosixShell(destination)
  return [
    `if command -v curl >/dev/null 2>&1; then curl -fsSL --retry 2 -o ${quotedDest} ${quotedUrl};`,
    `elif command -v wget >/dev/null 2>&1; then wget -q -O ${quotedDest} ${quotedUrl};`,
    `else echo "Neither curl nor wget is installed on this machine" >&2; exit 127; fi`
  ].join(' ')
}

/** Reads Content-Length so URL downloads can show a real percentage. */
export function posixUrlContentLengthCommand(url: string): string {
  const quotedUrl = quotePosixShell(url)
  return `command -v curl >/dev/null 2>&1 && curl -fsSLI ${quotedUrl} 2>/dev/null | awk 'tolower($1)=="content-length:"{v=$2} END{gsub(/\\r/,"",v); print v}'`
}

export function parseContentLength(output: string): number | null {
  const value = Number(output.trim())
  return Number.isFinite(value) && value > 0 ? value : null
}

export const INOTIFY_EVENTS = 'create,delete,move,modify,attrib'

/** Streams one line (the changed folder) per event; exits 127 when inotify-tools is missing. */
export function posixInotifyWatchCommand(dirs: string[]): string {
  const quoted = dirs.map(quotePosixShell).join(' ')
  return `command -v inotifywait >/dev/null 2>&1 || exit 127; exec inotifywait -m -q -e ${INOTIFY_EVENTS} --format '%w' -- ${quoted}`
}

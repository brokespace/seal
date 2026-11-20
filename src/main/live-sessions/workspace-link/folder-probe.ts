import { normalizeRuntimePathForComparison } from '../../../shared/cross-platform-path'
import { deriveGitRemoteIdentity } from '../../../shared/git/remotes/git-remote-identity'
import { getProjectIdentityKey } from '../../../shared/project-host-setup-projection'
import { quotePosixShell } from '../../../shared/shell/launch/shell-argument-quoting'
import type { LiveSessionHost } from '../hosts/live-session-hosts'
import type { FolderProbe } from './workspace-link-rules'

const PROBE_TIMEOUT_MS = 10_000
/** A folder its machine could not read is asked about again no sooner than this. */
const UNREADABLE_RETRY_MS = 10_000
/** A plain folder can become a repository: what a machine said stands this long. */
const ANSWER_TTL_MS = 60_000

/** Prints where a folder is: the machine's home and temp folder, its checkout, that checkout's remotes and its main checkout. */
export function folderProbeScript(folder: string): string {
  return `cd ${quotePosixShell(folder)} 2>/dev/null || { echo @@UNREADABLE; exit 0; }
echo "@@HOME $HOME"
echo "@@TMP \${TMPDIR:-}"
root=$(git rev-parse --show-toplevel 2>/dev/null) || root=
[ -n "$root" ] || { echo @@DONE; exit 0; }
echo "@@ROOT $root"
(cd "$root" && git remote -v 2>/dev/null) | sed 's/^/@@REMOTE /'
common=$(cd "$root" && cd "$(git rev-parse --git-common-dir 2>/dev/null)" 2>/dev/null && pwd -P) || common=
case $common in
  */.git)
    main=\${common%/.git}
    inside=$(cd "$main" 2>/dev/null && git rev-parse --is-inside-work-tree 2>/dev/null)
    if [ "$inside" = true ]; then echo "@@MAIN $main"; fi ;;
esac
echo @@DONE
`
}

function markedLines(output: string, marker: string): string[] {
  return output
    .split('\n')
    .filter((line) => line.startsWith(`${marker} `))
    .map((line) => line.slice(marker.length + 1))
}

function marked(output: string, marker: string): string | null {
  return markedLines(output, marker)[0]?.trim() || null
}

export function parseFolderProbe(output: string): FolderProbe {
  // A script cut short says nothing of the folder.
  if (!/^@@DONE$/m.test(output)) {
    return { kind: 'unreadable' }
  }
  const home = marked(output, '@@HOME')
  const tmp = marked(output, '@@TMP')
  const root = marked(output, '@@ROOT')
  if (!root) {
    return { kind: 'folder', home, tmp }
  }
  const main = marked(output, '@@MAIN')
  const linked =
    main !== null &&
    normalizeRuntimePathForComparison(main) !== normalizeRuntimePathForComparison(root)
  const identity = deriveGitRemoteIdentity(markedLines(output, '@@REMOTE').join('\n'))
  return {
    kind: 'repository',
    root,
    ...(linked ? { main } : {}),
    ...(identity
      ? { projectKey: getProjectIdentityKey({ id: '', gitRemoteIdentity: identity }) }
      : {}),
    home,
    tmp
  }
}

/** What each machine said about each folder, asked once at a time. */
export class FolderProbes {
  private readonly answers = new Map<string, { probe: FolderProbe; until: number }>()
  private readonly asking = new Map<string, Promise<FolderProbe>>()

  constructor(private readonly now: () => number = Date.now) {}

  /** An unreachable machine answers as an unreadable folder does: its session waits for a later scan. */
  read(host: LiveSessionHost, folder: string): Promise<FolderProbe> {
    const key = `${host.machine.hostId}\0${folder}`
    const known = this.answers.get(key)
    if (known && this.now() < known.until) {
      return Promise.resolve(known.probe)
    }
    const running = this.asking.get(key)
    if (running) {
      return running
    }
    const asked = host
      .run(folderProbeScript(folder), { timeoutMs: PROBE_TIMEOUT_MS })
      .then(parseFolderProbe)
      .catch((): FolderProbe => ({ kind: 'unreadable' }))
      .then((probe) => {
        const now = this.now()
        for (const [stale, answer] of this.answers) {
          if (now >= answer.until) {
            this.answers.delete(stale)
          }
        }
        const ttl = probe.kind === 'unreadable' ? UNREADABLE_RETRY_MS : ANSWER_TTL_MS
        this.answers.set(key, { probe, until: now + ttl })
        this.asking.delete(key)
        return probe
      })
    this.asking.set(key, asked)
    return asked
  }
}

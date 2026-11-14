import type { MachineCleanupTargetId } from '../../../shared/machines/machine-resource-types'
import type { MachineConnection } from '../connection/machine-connection'
import {
  isRemovableCleanupPath,
  type MachineCleanupPlan,
  type PlannedCleanupItem
} from './machine-cleanup-plan'
import { runMachineHostScript } from './machine-host-script'

const SCAN_TIMEOUT_MS = 5 * 60_000
const MAX_FOLDERS = 300
const MAX_LOG_FILES = 500
const OLD_LOG_DAYS = 14

export type MachinePathCleanupTarget = Extract<
  MachineCleanupTargetId,
  'package-caches' | 'node-modules' | 'trash' | 'old-logs' | 'seal-caches'
>

// Rows are `I <kb> <mtime> <group> <path>`, tab separated; `E <path>` rows list folders to empty
// instead of removing the item's own path, and `N <count>` is the number of matches before a cap.
const PRELUDE = `
tab=$(printf '\\t')
echo "H$tab$HOME"
cache="\${XDG_CACHE_HOME:-$HOME/.cache}"
mtime() { stat -c %Y "$1" 2>/dev/null || stat -f %m "$1" 2>/dev/null || echo 0; }
item() {
  [ -e "$2" ] || return 0
  kb=$(du -sk "$2" 2>/dev/null | awk '{ print $1; exit }')
  printf 'I\\t%s\\t%s\\t%s\\t%s\\n' "\${kb:-0}" "$(mtime "$2")" "$1" "$2"
}
`

const SCRIPTS: Record<MachinePathCleanupTarget, string> = {
  'package-caches': `
item npm "$HOME/.npm/_cacache"
item pnpm "$cache/pnpm"
item pnpm "$HOME/Library/Caches/pnpm"
for store in "\${XDG_DATA_HOME:-$HOME/.local/share}/pnpm/store" "$HOME/Library/pnpm/store" "$HOME/.pnpm-store"; do
  [ -d "$store" ] || continue
  # Projects link into a global virtual store, so removing one would break them.
  if find "$store" -mindepth 2 -maxdepth 2 -name links -type d 2>/dev/null | grep -q .; then continue; fi
  item "pnpm store" "$store"
done
item yarn "$cache/yarn"
item yarn "$HOME/Library/Caches/Yarn"
item yarn "$HOME/.yarn/berry/cache"
item pip "$cache/pip"
item pip "$HOME/Library/Caches/pip"
item uv "$cache/uv"
cargo="\${CARGO_HOME:-$HOME/.cargo}"
item cargo "$cargo/registry/cache"
item cargo "$cargo/registry/src"
item cargo "$cargo/git/checkouts"
item Homebrew "$HOME/Library/Caches/Homebrew"
item Homebrew "$cache/Homebrew"
item go "$cache/go-build"
item go "$HOME/Library/Caches/go-build"
item bun "$HOME/.bun/install/cache"
`,
  // Hidden folders and ~/Library hold tool installs whose node_modules are not the user's projects.
  'node-modules': `
found=$(find "$HOME" -mindepth 1 -xdev \\( -name '.*' -o -name Library -o -name Applications \\) -prune -o -type d -name node_modules -prune -print 2>/dev/null)
printf '%s\\n' "$found" | while IFS= read -r dir; do
  [ -n "$dir" ] && item node_modules "$dir"
done | sort -t "$tab" -k2,2nr | head -n ${MAX_FOLDERS}
echo "N$tab$(printf '%s\\n' "$found" | grep -c .)"
`,
  trash: `
if [ "$(uname -s)" = Darwin ]; then trash="$HOME/.Trash"; inner="$trash"; else trash="\${XDG_DATA_HOME:-$HOME/.local/share}/Trash"; inner="$trash/files"; fi
[ -d "$inner" ] || return 0
count=$(find "$inner" -mindepth 1 -maxdepth 1 2>/dev/null | grep -c .)
[ "$count" -gt 0 ] || return 0
item "$count" "$trash"
if [ "$inner" = "$trash" ]; then echo "E$tab$trash"; else
  for part in files info expunged; do [ -d "$trash/$part" ] && echo "E$tab$trash/$part"; done
fi
`,
  'old-logs': `
{
  for dir in "$HOME/.npm/_logs" "$HOME/.pm2/logs" "$HOME/Library/Logs" "\${XDG_STATE_HOME:-$HOME/.local/state}" "$cache"; do
    [ -d "$dir" ] || continue
    find "$dir" -xdev -type f \\( -name '*.log' -o -name '*.log.[0-9]*' -o -name '*.log.gz' \\) -mtime +${OLD_LOG_DAYS} -exec du -k {} + 2>/dev/null
  done
  # Only rotated system logs, and only the ones this user owns.
  if [ -d /var/log ]; then
    find /var/log -xdev -type f \\( -name '*.gz' -o -name '*.[0-9]' -o -name '*.old' \\) -mtime +${OLD_LOG_DAYS} -user "$(id -un)" -exec du -k {} + 2>/dev/null
  fi
} | sort -rn | awk -F"$tab" -v max=${MAX_LOG_FILES} '{ n++; if (n <= max) printf "I\\t%s\\t0\\tlog\\t%s\\n", $1, $2 } END { print "N\\t" n + 0 }'
`,
  'seal-caches': `
for job in "$HOME/.seal/jobs"/*; do
  [ -d "$job" ] && [ -f "$job/exit" ] && item "finished job" "$job"
done
tmp="\${TMPDIR:-/tmp}"
find "$tmp" -maxdepth 1 -name '.seal-*' -user "$(id -un)" -mmin +60 2>/dev/null | while IFS= read -r left; do
  item "scan leftovers" "$left"
done
for staged in "$tmp"/seal-machine-drag-*; do
  [ -d "$staged" ] || continue
  kill -0 "\${staged##*-}" 2>/dev/null || item "drag staging" "$staged"
done
`
}

const PRESELECTED: Record<MachinePathCleanupTarget, (group: string) => boolean> = {
  'package-caches': (group) => group !== 'pnpm store',
  // Deleting a project's dependencies is a per-project call.
  'node-modules': () => false,
  trash: () => true,
  'old-logs': () => true,
  'seal-caches': () => true
}

export function parsePathCleanupScan(
  target: MachinePathCleanupTarget,
  output: string
): MachineCleanupPlan {
  const items: PlannedCleanupItem[] = []
  let homeDir: string | null = null
  let matched: number | null = null
  for (const line of output.split(/\r?\n/)) {
    const fields = line.split('\t')
    if (fields[0] === 'H') {
      homeDir = fields[1] ?? null
    } else if (fields[0] === 'N') {
      matched = Number(fields[1]) || 0
    } else if (fields[0] === 'E' && items.length > 0) {
      const last = items.at(-1)!
      const path = fields.slice(1).join('\t')
      if (isRemovableCleanupPath(path, homeDir)) {
        last.action =
          last.action.kind === 'empty'
            ? { kind: 'empty', paths: [...last.action.paths, path] }
            : { kind: 'empty', paths: [path] }
      }
    } else if (fields[0] === 'I' && fields.length >= 5) {
      const path = fields.slice(4).join('\t')
      if (!isRemovableCleanupPath(path, homeDir)) {
        continue
      }
      const mtimeSeconds = Number(fields[2])
      const group = fields[3]
      items.push({
        id: `${target}:${items.length}`,
        label: path,
        group: target === 'trash' ? null : group,
        bytes: Number(fields[1]) * 1024,
        modifiedAt: mtimeSeconds > 0 ? mtimeSeconds * 1000 : null,
        preselected: PRESELECTED[target](group),
        action: { kind: 'remove', path }
      })
    }
  }
  // A trash row without folders to empty would remove the trash folder itself.
  const listed = target === 'trash' ? items.filter((item) => item.action.kind === 'empty') : items
  return {
    items: listed,
    omittedCount: Math.max(0, (matched ?? listed.length) - listed.length),
    unavailable: null
  }
}

export async function scanPathCleanupTarget(
  connection: MachineConnection,
  target: MachinePathCleanupTarget
): Promise<MachineCleanupPlan> {
  const result = await runMachineHostScript(connection, PRELUDE + SCRIPTS[target], {
    timeoutMs: SCAN_TIMEOUT_MS
  })
  return parsePathCleanupScan(target, result.stdout)
}

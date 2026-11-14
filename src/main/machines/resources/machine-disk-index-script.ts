import type { MachineDiskIndexRequest } from '../../../shared/machines/machine-disk-index-types'
import { quotePosixShell } from '../../../shared/shell/launch/shell-argument-quoting'
import { orcadPosixNodeRuntimeGlobs } from '../../managed-server/install/orcad-node-runtime-globs'

/** Folder under the machine's home holding the index program, its socket and the stored indexes. */
export const DISK_INDEX_REMOTE_DIR = '.seal/disk-index'
export const DISK_INDEX_NO_PROGRAM = '@noprogram'
export const DISK_INDEX_NO_NODE = '@nonode'
export const DISK_INDEX_NO_DAEMON = '@nodaemon'

const NO_DAEMON_EXIT_CODE = 3
const MINIMUM_NODE_MAJOR = 20
/** A machine Seal no longer talks to stops indexing on its own. */
const REMOTE_IDLE_EXIT_HOURS = 7 * 24

export type DiskIndexScriptInput = {
  programName: string
  request: MachineDiskIndexRequest
  /** This computer: the runtime Seal itself runs on, and the process the daemon should stop with. */
  local: { node: string; ownerPid: number } | null
}

/**
 * Asks the machine's index daemon one question, starting it first when it is not running. The
 * daemon is started at the lowest CPU and disk priority the machine offers.
 */
export function buildDiskIndexScript(input: DiskIndexScriptInput): string {
  const request = Buffer.from(JSON.stringify(input.request), 'utf8').toString('base64')
  const [orcadRuntime, orcadMachineRuntimes] = orcadPosixNodeRuntimeGlobs()
  const lifetime = input.local
    ? `--owner-pid ${input.local.ownerPid}`
    : `--idle-exit-hours ${REMOTE_IDLE_EXIT_HOURS}`
  const hint = input.local ? quotePosixShell(input.local.node) : '""'
  return `
dir="$HOME/${DISK_INDEX_REMOTE_DIR}"
program="$dir/${input.programName}"
[ -f "$program" ] || { echo "${DISK_INDEX_NO_PROGRAM}"; return 0; }
ELECTRON_RUN_AS_NODE=1; export ELECTRON_RUN_AS_NODE
node=${hint}
[ -n "$node" ] || node=$(cat "$dir/node-path" 2>/dev/null)
if [ -z "$node" ] || [ ! -x "$node" ]; then
  node=""
  for c in "$(command -v node 2>/dev/null || true)" "$HOME/.nvm/versions/node"/*/bin/node /usr/local/bin/node /usr/bin/node /opt/homebrew/bin/node "$HOME/.local/bin/node" ${orcadRuntime} ${orcadMachineRuntimes}; do
    [ -n "$c" ] && [ -x "$c" ] || continue
    if "$c" -e 'process.exit(Number(process.versions.node.split(".")[0])>=${MINIMUM_NODE_MAJOR}?0:1)' 2>/dev/null; then
      node="$c"
      break
    fi
  done
  [ -n "$node" ] || { echo "${DISK_INDEX_NO_NODE}"; return 0; }
  printf '%s' "$node" > "$dir/node-path"
fi
"$node" "$program" query ${request}
[ $? = ${NO_DAEMON_EXIT_CODE} ] || return 0
for old in "$dir"/disk-usage-index-*.cjs; do
  [ "$old" = "$program" ] || rm -f "$old"
done
low=""
if [ "$(uname -s)" = Darwin ]; then
  command -v taskpolicy >/dev/null 2>&1 && low="taskpolicy -b"
else
  command -v nice >/dev/null 2>&1 && low="nice -n 19"
  command -v ionice >/dev/null 2>&1 && low="ionice -c 3 $low"
fi
nohup $low "$node" "$program" daemon ${lifetime} >"$dir/daemon.log" 2>&1 &
tries=0
while [ $tries -lt 50 ]; do
  sleep 0.2
  "$node" "$program" query ${request}
  [ $? = ${NO_DAEMON_EXIT_CODE} ] || return 0
  tries=$((tries + 1))
done
echo "${DISK_INDEX_NO_DAEMON}"
`
}

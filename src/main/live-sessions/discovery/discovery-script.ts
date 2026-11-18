// One POSIX sh script gathers everything a scan needs, so an SSH host costs one round trip.
// Output is line-framed: `@@<SECTION> fields…`, binary-ish payloads base64 on a single line.

import { TRANSCRIPT_LOG_MARKS, TURN_TAIL_WINDOW_FACTOR } from './transcript-turn-tail'
import { quotePosixShell } from '../../../shared/shell/launch/shell-argument-quoting'
import { autoCompactConfigSection, type AgentConfigRoots } from './host-auto-compact-config'

export type DiscoveryScriptOptions = {
  /** Transcripts untouched for longer than this are not live, unless a running agent owns them. */
  maxAgeMinutes: number
  maxFiles: number
  /** Transcripts whose bytes are sent per scan; the rest wait for the next one (SSH output is capped). */
  maxReads: number
  headBytes: number
  tailBytes: number
  /** Subagent transcripts listed per session, and how many are read per scan across the host. */
  maxSubagents: number
  maxSubagentReads: number
  subagentTailBytes: number
  /** False when the host finds transcripts another way (this machine uses AI Vault discovery). */
  transcripts: boolean
  /** `path|size` of transcripts and subagent transcripts already read at that size: their bytes are skipped. */
  known: { path: string; size: number }[]
  /** Paths whose head was already read: only their tail is sent when they grow. */
  headKnown: string[]
  /** Jobs to look for among the processes no agent runs; none asks nothing of the host. */
  jobs?: readonly HostJobQuery[]
  /** Config roots, besides the default ones, that the transcripts read so far live under. */
  configRoots?: AgentConfigRoots
}

/** A job that outlived the call that started it, as a host can find it among its processes. */
export type HostJobQuery = {
  /** Its process started between the two (epoch seconds, host clock). */
  from: number
  until: number
  /** Its command line carries one of these; `#<pid>` names the process itself. */
  names: readonly string[]
  /** Only a process with no terminal: not something the user runs in theirs. */
  noTerminal: boolean
}

/** The agent processes of a host, then `@@PS` when ps listed processes at all. */
const AGENT_PROCESS_LINES = `ps -A -o pid= -o ppid= -o tty= -o args= 2>/dev/null | awk '{ c=$4; s=$5; if (c ~ /(^|\\/)(claude|codex)$/ || c ~ /\\/claude\\/versions\\/[0-9][0-9.]*$/ || (c ~ /(^|\\/)node$/ && (s ~ /(^|\\/)(claude|codex)(\\.js)?$/ || s ~ /claude-code\\/cli\\.js$/ || s ~ /@openai\\/codex\\//))) print } END { if (NR) print "@@PS" }'`

/** Only which agents run: a tenth of a scan's cost, to tell whether one started or ended. */
export function buildAgentProbeScript(): string {
  return `export LC_ALL=C
${AGENT_PROCESS_LINES} | while read -r pid ppid tty args; do
  [ "$pid" = "@@PS" ] && { echo "@@PS"; continue; }
  echo "@@PROC $pid $ppid $tty $args"
done
echo "@@DONE"
`
}

/** Only the jobs asked about: for what a scan's own read of the transcripts turned up. */
export function buildJobProbeScript(jobs: readonly HostJobQuery[]): string {
  return `export LC_ALL=C
AGENTS=' '
${AGENT_PROCESS_LINES} | {
while read -r pid rest; do
  [ "$pid" = "@@PS" ] || AGENTS="$AGENTS$pid "
done
${jobSection(jobs)}}
echo "@@DONE"
`
}

export function buildDiscoveryScript(options: DiscoveryScriptOptions): string {
  const known = options.known.map((k) => `${k.path}|${k.size}`).join('\n')
  const headKnown = options.headKnown.join('\n')
  return `set +e
export LC_ALL=C
b64() { base64 | tr -d '\\n'; }
fsize() { stat -c '%s %Y' "$1" 2>/dev/null || stat -f '%z %m' "$1" 2>/dev/null; }
echo "@@NOW $(date +%s)"
echo "@@UNAME $(uname -s)"
KNOWN=${quotePosixShell(known)}
HEADKNOWN=${quotePosixShell(headKnown)}
TTYS='|'
AGENTS=' '
PINS="\${TMPDIR:-/tmp}/.seal-live-pins.$$"
: > "$PINS"
SUBREADS="\${TMPDIR:-/tmp}/.seal-live-subs.$$"
: > "$SUBREADS"
pin() { [ -f "$4" ] && echo "$1 $2 $3 $4" >> "$PINS"; }
CLAUDE_ROOTS="$HOME/.claude
\${CLAUDE_CONFIG_DIR:-}"
CODEX_ROOTS="$HOME/.codex
\${CODEX_HOME:-}"
${AGENT_PROCESS_LINES} > "\${TMPDIR:-/tmp}/.seal-live-ps.$$"
while read -r pid ppid tty args; do
  # The listing ends by saying ps listed processes at all: no agent among them means none runs.
  [ "$pid" = "@@PS" ] && { echo "@@PS"; continue; }
  echo "@@PROC $pid $ppid $tty $args"
  AGENTS="$AGENTS$pid "
  cwd=$(readlink "/proc/$pid/cwd" 2>/dev/null)
  if [ -z "$cwd" ] && command -v lsof >/dev/null 2>&1; then
    # For another user's process lsof names the link it could not read, not a folder.
    cwd=$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n '/ (readlink: /d;s/^n//p' | head -n 1)
  fi
  [ -n "$cwd" ] && echo "@@CWD $pid $cwd"
  case "$tty" in ''|'?'|'??') ;; *) TTYS="$TTYS$tty|" ;; esac
${pinSection()}
done < "\${TMPDIR:-/tmp}/.seal-live-ps.$$"
rm -f "\${TMPDIR:-/tmp}/.seal-live-ps.$$"
${childSection()}${jobSection(options.jobs ?? [])}if command -v tmux >/dev/null 2>&1; then
  SOCKS=""
  for d in "\${TMUX_TMPDIR:-}" /tmp "\${TMPDIR:-/tmp}"; do
    [ -n "$d" ] || continue
    for s in "$d"/tmux-$(id -u)/*; do [ -S "$s" ] && SOCKS="$SOCKS
$s"; done
  done
  echo "$SOCKS" | sort -u | while read -r sock; do
    [ -n "$sock" ] || continue
    # Spaces, not tabs: tmux 3.x prints control characters in -F output as '_'. The name comes last.
    tmux -S "$sock" list-panes -a -F '#{pane_id} #{pane_tty} #{pane_pid} #{session_name}:#{window_index}.#{pane_index}' 2>/dev/null | while read -r pane ptty ppid name; do
      echo "@@TMUX $sock	$pane	$ptty	$ppid	$name"
      short=\${ptty#/dev/}
      case "$TTYS" in *"|$short|"*)
        printf '@@SCREEN %s\\t%s ' "$sock" "$pane"
        tmux -S "$sock" capture-pane -p -e -t "$pane" 2>/dev/null | b64
        echo ;;
      esac
    done
  done
fi
for d in "$HOME/.claude/sessions" "\${CLAUDE_CONFIG_DIR:-}/sessions"; do
  [ -d "$d" ] || continue
  for f in "$d"/[0-9]*.json; do
    [ -f "$f" ] || continue
    printf '@@CLAUDESESSION %s ' "$f"; head -c 8192 "$f" | b64; echo
  done
done
# SISomewhere's hooks record each session's harness pid and transcript; read them, never write them.
for f in "$HOME"/.config/sisomewhere/agents/*.json; do
  [ -f "$f" ] || continue
  printf '@@HOOK %s ' "$f"; b64 < "$f"; echo
  hp=$(sed -n 's/.*"pid"[[:space:]]*:[[:space:]]*\\([0-9][0-9]*\\).*/\\1/p' "$f" | head -n 1)
  ht=$(sed -n 's/.*"transcript"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/p' "$f" | head -n 1)
  [ -n "$hp" ] && [ -n "$ht" ] && kill -0 "$hp" 2>/dev/null && pin "$hp" hook claude "$ht"
done
sort -u "$PINS" | sed 's/^/@@PIN /'
${autoCompactConfigSection(options.configRoots ?? { claude: [], codex: [] })}${transcriptSection(options)}rm -f "$PINS" "$SUBREADS"
echo "@@DONE"
`
}

/**
 * How long each agent has run and what it runs under, then what runs under it: a shell command it started shows here
 * while its transcript stands still. Only the process's kind and name leave the host, never its
 * arguments.
 */
function childSection(): string {
  return `ps -A -o pid= -o ppid= -o etime= -o args= 2>/dev/null | awk -v roots="$AGENTS" '
BEGIN { n = split(roots, r, " "); for (i = 1; i <= n; i++) under[r[i]] = 1 }
{
  if ($1 in under) { listed = 1; print "@@AGE", $1, $3 }
  pid[NR] = $1; ppid[NR] = $2; et[NR] = $3; parent[$1] = $2
  c = $4; sub(/.*\\//, "", c)
  k = "other"
  if ($0 ~ /\\/shell[-_]snapshots\\//) k = "snapshot"
  else if (c ~ /^(codex-linux-sandbox|bwrap|sandbox-exec)$/) k = "sandbox"
  else if (c ~ /^-?(sh|bash|zsh|dash|ksh|fish)$/) k = "shell"
  kind[NR] = k; comm[NR] = substr(c, 1, 40)
}
END {
  # A ps that cannot list this way shows no agent either: say nothing rather than "no children".
  if (!listed) exit
  for (i = 1; i <= n; i++) {
    line = "@@UP " r[i]
    for (p = parent[r[i]]; p > 1 && d[i]++ < 64; p = parent[p]) line = line " " p
    print line
  }
  print "@@CHILDREN"
  do {
    grew = 0
    for (i = 1; i <= NR; i++) if (!(pid[i] in under) && (ppid[i] in under)) { under[pid[i]] = 1; grew = 1 }
  } while (grew)
  for (i = 1; i <= NR; i++) if (ppid[i] in under) print "@@CHILD", pid[i], ppid[i], et[i], kind[i], comm[i]
}'
`
}

/** A process starts within this of the call that started it, and `ps` counts whole seconds. */
const JOB_START_SLACK_SECONDS = 3

/**
 * The processes of this user that no agent runs and that a query describes: started inside its
 * window, with one of its names on their command line. The names are matched here, so only each
 * process's id, start and name leave the host, never its arguments.
 */
function jobSection(jobs: readonly HostJobQuery[]): string {
  if (jobs.length === 0) {
    return ''
  }
  const asked = jobs
    .map((job) => [job.from, job.until, job.noTerminal ? 'n' : 't', ...job.names].join(' '))
    .join(';')
  return `ps -A -o uid= -o pid= -o ppid= -o tty= -o etime= -o args= 2>/dev/null | awk -v roots="$AGENTS" -v self="$$" -v uid="$(id -u)" -v now="$(date +%s)" -v jobs=${quotePosixShell(asked)} '
function seconds(e,  p, n, d) {
  d = 0
  if (index(e, "-")) { d = substr(e, 1, index(e, "-") - 1); e = substr(e, index(e, "-") + 1) }
  n = split(e, p, ":")
  return d * 86400 + (n == 3 ? p[1] * 3600 + p[2] * 60 + p[3] : p[1] * 60 + p[2])
}
BEGIN { n = split(roots, r, " "); for (i = 1; i <= n; i++) skip[r[i]] = 1; skip[self] = 1; q = split(jobs, job, ";") }
{
  mine[NR] = ($1 == uid); pid[NR] = $2; ppid[NR] = $3; parent[$2] = $3
  bare[NR] = ($4 !~ /[0-9]/); start[NR] = now - seconds($5)
  c = $6; sub(/.*\\//, "", c); comm[NR] = substr(c, 1, 40)
  a = $0; sub(/^ *[^ ]+ +[^ ]+ +[^ ]+ +[^ ]+ +[^ ]+ +/, "", a); args[NR] = a
}
END {
  # A ps that cannot list this way says nothing: no answer is not "no such job".
  if (!NR) exit
  do {
    grew = 0
    for (i = 1; i <= NR; i++) if (!(pid[i] in skip) && (ppid[i] in skip)) { skip[pid[i]] = 1; grew = 1 }
  } while (grew)
  # What runs this script carries the names on its own command line.
  for (p = parent[self]; p > 1 && depth++ < 64; p = parent[p]) skip[p] = 1
  for (i = 1; i <= NR; i++) {
    if (!mine[i] || (pid[i] in skip)) continue
    for (j = 1; j <= q; j++) {
      m = split(job[j], f, " ")
      if (start[i] < f[1] - ${JOB_START_SLACK_SECONDS} || start[i] > f[2] + ${JOB_START_SLACK_SECONDS}) continue
      if (f[3] == "n" && !bare[i]) continue
      for (k = 4; k <= m; k++) if (f[k] == ("#" pid[i]) || index(args[i], f[k])) {
        print "@@JOB", j - 1, k - 4, pid[i], start[i], comm[i]
        found++
        break
      }
    }
  }
  # Counted, so a listing whose first lines were cut off is not read as "no such job".
  print "@@JOBS", found + 0
}'
`
}

/**
 * Transcripts a running agent writes, however long ago it last wrote: the file it holds open,
 * the session its registry entry or command line names, else (Claude) its folder's newest.
 */
function pinSection(): string {
  return `  pinned=
  for fd in /proc/$pid/fd/*; do
    t=$(readlink "$fd" 2>/dev/null)
    case "$t" in
      */sessions/*/rollout-*.jsonl) pin "$pid" open codex "$t"; pinned=1 ;;
      */projects/*/*.jsonl) pin "$pid" open claude "$t"; pinned=1 ;;
    esac
  done
  if [ -z "$pinned" ] && [ ! -d "/proc/$pid" ] && command -v lsof >/dev/null 2>&1; then
    case "$args" in *codex*)
      for t in $(lsof -p "$pid" -Fn 2>/dev/null | sed -n 's/^n\\(.*\\/rollout-[^ ]*\\.jsonl\\)$/\\1/p'); do
        pin "$pid" open codex "$t"; pinned=1
      done ;;
    esac
  fi
  [ -n "$pinned" ] && continue
  ids=
  for d in $CLAUDE_ROOTS; do
    [ -f "$d/sessions/$pid.json" ] && ids="$ids $(sed -n 's/.*"sessionId"[[:space:]]*:[[:space:]]*"\\([0-9a-fA-F-]*\\)".*/\\1/p' "$d/sessions/$pid.json" | head -n 1)"
  done
  set -f
  prev=
  for w in $args; do
    case "$prev" in --resume|-r|--session-id|resume)
      case "$w" in *[!0-9a-fA-F-]*|'') ;; *) ids="$ids $w" ;; esac ;;
    esac
    prev=$w
  done
  set +f
  for id in $ids; do
    for d in $CLAUDE_ROOTS; do
      for t in "$d"/projects/*/"$id".jsonl; do pin "$pid" id claude "$t" && pinned=1; done
    done
    case "$args" in *codex*)
      for d in $CODEX_ROOTS; do
        [ -d "$d/sessions" ] || continue
        for t in $(find "$d/sessions" -type f -name "rollout-*-$id.jsonl" 2>/dev/null); do pin "$pid" id codex "$t" && pinned=1; done
      done ;;
    esac
  done
  [ -n "$pinned" ] || [ -z "$cwd" ] && continue
  case "$args" in *codex*) continue ;; esac
  enc=$(printf '%s' "$cwd" | sed 's/[^A-Za-z0-9]/-/g')
  for d in $CLAUDE_ROOTS; do
    t=$(ls -t "$d/projects/$enc"/*.jsonl 2>/dev/null | head -n 1)
    [ -n "$t" ] && pin "$pid" cwd claude "$t"
  done`
}

/**
 * A Claude session's subagents write `<session>/subagents/agent-<id>.jsonl`. They are listed with
 * every scan (a subagent works while its session's own file stands still); bytes follow the read budget.
 */
function subagentSection(options: DiscoveryScriptOptions): string {
  return `  sd="\${f%.jsonl}/subagents"
  if [ "$provider" = claude ] && [ -d "$sd" ]; then
    ls -t "$sd"/agent-*.jsonl 2>/dev/null | head -n ${options.maxSubagents} | while read -r sf; do
      set -- $(fsize "$sf")
      [ -n "$2" ] || continue
      echo "@@SUB $1 $2 $sf"
      mf="\${sf%.jsonl}.meta.json"
      fresh=; [ $(( $(date +%s) - $2 )) -lt 600 ] && fresh=1
      seen=; printf '%s\\n' "$KNOWN" | grep -Fxq "$sf|$1" && seen=1
      if [ -f "$mf" ] && { [ -n "$fresh" ] || [ -z "$seen" ]; }; then
        printf '@@SUBMETA %s ' "$sf"; head -c 4096 "$mf" | b64; echo
      fi
      [ -n "$seen" ] && continue
      [ "$(wc -l < "$SUBREADS")" -ge ${options.maxSubagentReads} ] && continue
      echo x >> "$SUBREADS"
      printf '@@SUBTAIL %s ' "$sf"; tail -c ${options.subagentTailBytes} "$sf" | b64; echo
    done
  fi
`
}

function transcriptSection(options: DiscoveryScriptOptions): string {
  if (!options.transcripts) {
    return ''
  }
  // Pinned files sort first, so the file and read limits never drop a running agent's transcript.
  return `{
  for root in "$HOME/.claude/projects" "\${CLAUDE_CONFIG_DIR:+$CLAUDE_CONFIG_DIR/projects}"; do
    [ -n "$root" ] && [ -d "$root" ] && find "$root" -mindepth 2 -maxdepth 2 -type f -name '*.jsonl' -mmin -${options.maxAgeMinutes} 2>/dev/null | sed 's/^/0 claude /'
  done
  for root in "$HOME/.codex/sessions" "\${CODEX_HOME:+$CODEX_HOME/sessions}"; do
    [ -n "$root" ] && [ -d "$root" ] && find "$root" -type f -name 'rollout-*.jsonl' -mmin -${options.maxAgeMinutes} 2>/dev/null | sed 's/^/0 codex /'
  done
  awk '{ print "1", $3, substr($0, index($0, $4)) }' "$PINS"
} | awk '{ f = $0; sub(/^[^ ]+ [^ ]+ /, "", f); if (!(f in pri) || $1 > pri[f]) { pri[f] = $1; prov[f] = $2 } } END { for (f in pri) print pri[f], prov[f], f }' | while read -r pri provider f; do
  set -- $(fsize "$f")
  [ -n "$2" ] && echo "$pri $2 $1 $provider $f"
done | sort -k1,1nr -k2,2nr | head -n ${options.maxFiles} | { reads=0; while read -r pri mtime size provider f; do
  echo "@@FILE $provider $size $mtime $f"
${subagentSection(options)}  if printf '%s\\n' "$KNOWN" | grep -Fxq "$f|$size"; then continue; fi
  [ "$reads" -ge ${options.maxReads} ] && continue
  reads=$((reads + 1))
  if ! printf '%s\\n' "$HEADKNOWN" | grep -Fxq "$f"; then
    printf '@@HEAD %s ' "$f"; head -c ${options.headBytes} "$f" | b64; echo
  fi
  printf '@@TAIL %s ' "$f"; tail -c ${options.tailBytes * TURN_TAIL_WINDOW_FACTOR} "$f" | grep -v -F ${TRANSCRIPT_LOG_MARKS.map((mark) => `-e ${quotePosixShell(mark)}`).join(' ')} | tail -c ${options.tailBytes} | b64; echo
done; }
`
}

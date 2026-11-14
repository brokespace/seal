// One POSIX sh script gathers everything a scan needs, so an SSH host costs one round trip.
// Output is line-framed: `@@<SECTION> fields…`, binary-ish payloads base64 on a single line.

export type DiscoveryScriptOptions = {
  /** Transcripts untouched for longer than this are not live, unless a running agent owns them. */
  maxAgeMinutes: number
  maxFiles: number
  /** Transcripts whose bytes are sent per scan; the rest wait for the next one (SSH output is capped). */
  maxReads: number
  headBytes: number
  tailBytes: number
  /** False when the host finds transcripts another way (this machine uses AI Vault discovery). */
  transcripts: boolean
  /** `path|size` of transcripts already read at that size: their bytes are skipped. */
  known: { path: string; size: number }[]
  /** Paths whose head was already read: only their tail is sent when they grow. */
  headKnown: string[]
}

function shQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
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
KNOWN=${shQuote(known)}
HEADKNOWN=${shQuote(headKnown)}
TTYS='|'
PINS="\${TMPDIR:-/tmp}/.seal-live-pins.$$"
: > "$PINS"
pin() { [ -f "$4" ] && echo "$1 $2 $3 $4" >> "$PINS"; }
CLAUDE_ROOTS="$HOME/.claude
\${CLAUDE_CONFIG_DIR:-}"
CODEX_ROOTS="$HOME/.codex
\${CODEX_HOME:-}"
ps -A -o pid= -o ppid= -o tty= -o args= 2>/dev/null | awk '{ c=$4; s=$5; if (c ~ /(^|\\/)(claude|codex)$/ || c ~ /\\/claude\\/versions\\/[0-9][0-9.]*$/ || (c ~ /(^|\\/)node$/ && (s ~ /(^|\\/)(claude|codex)(\\.js)?$/ || s ~ /claude-code\\/cli\\.js$/ || s ~ /@openai\\/codex\\//))) print }' > "\${TMPDIR:-/tmp}/.seal-live-ps.$$"
while read -r pid ppid tty args; do
  echo "@@PROC $pid $ppid $tty $args"
  cwd=$(readlink "/proc/$pid/cwd" 2>/dev/null)
  if [ -z "$cwd" ] && command -v lsof >/dev/null 2>&1; then
    cwd=$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1)
  fi
  [ -n "$cwd" ] && echo "@@CWD $pid $cwd"
  case "$tty" in ''|'?'|'??') ;; *) TTYS="$TTYS$tty|" ;; esac
${pinSection()}
done < "\${TMPDIR:-/tmp}/.seal-live-ps.$$"
rm -f "\${TMPDIR:-/tmp}/.seal-live-ps.$$"
if command -v tmux >/dev/null 2>&1; then
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
${transcriptSection(options)}rm -f "$PINS"
echo "@@DONE"
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
  if printf '%s\\n' "$KNOWN" | grep -Fxq "$f|$size"; then continue; fi
  [ "$reads" -ge ${options.maxReads} ] && continue
  reads=$((reads + 1))
  if ! printf '%s\\n' "$HEADKNOWN" | grep -Fxq "$f"; then
    printf '@@HEAD %s ' "$f"; head -c ${options.headBytes} "$f" | b64; echo
  fi
  printf '@@TAIL %s ' "$f"; tail -c ${options.tailBytes} "$f" | b64; echo
done; }
`
}

import {
  AGENT_ONE_SHOT_FLAGS,
  AGENT_ONE_SHOT_SUBCOMMANDS,
  AGENT_TOOL_SUBCOMMANDS
} from '../live-sessions/agent-subcommands'
import type { LiveSessionProvider } from '../live-sessions/live-session-types'

export const WRAPPED_AGENTS: readonly LiveSessionProvider[] = ['claude', 'codex']

function casePattern(words: (provider: LiveSessionProvider) => readonly string[]): string {
  return WRAPPED_AGENTS.flatMap((provider) => words(provider).map((w) => `${provider}:${w}`)).join(
    '|'
  )
}

/**
 * `seal-wrap NAME ARGS...`: runs the real claude/codex inside Seal's private tmux server so Seal
 * can type into it. Anything it can't wrap cleanly runs the real binary unchanged.
 */
export function sealWrapScript(): string {
  const subcommands = casePattern((p) => [
    ...AGENT_TOOL_SUBCOMMANDS[p],
    ...AGENT_ONE_SHOT_SUBCOMMANDS[p]
  ])
  const flags = casePattern((p) => AGENT_ONE_SHOT_FLAGS[p])
  return `#!/bin/sh
# Installed by \`seal shell-integration install\`; remove with \`seal shell-integration uninstall\`.
name=$1
shift
real=$(command -v "$name" 2>/dev/null) || real=
case $real in
  /*) ;;
  *) echo "seal: $name: command not found" >&2; exit 127 ;;
esac
direct() { exec "$real" "$@"; }

here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || direct "$@"
seal=$(dirname -- "$here")
[ "\${SEAL_NO_WRAP:-}" = 1 ] && direct "$@"
# Already somewhere Seal can type into: another tmux or a Seal pane.
[ -n "\${TMUX:-}\${ORCA_PANE_KEY:-}\${ORCA_TERMINAL_HANDLE:-}" ] && direct "$@"
[ -e "$here/disabled" ] && direct "$@"
[ -t 0 ] && [ -t 1 ] || direct "$@"
command -v tmux >/dev/null 2>&1 || direct "$@"
case $(tmux -V 2>/dev/null) in
  "tmux "[3-9]* | "tmux "[1-9][0-9]* | "tmux next-"* | "tmux master"*) ;;
  *) direct "$@" ;;
esac
case "$name:\${1:-}" in
  ${subcommands}) direct "$@" ;;
esac
for arg in "$@"; do
  case "$name:$arg" in
    ${flags}) direct "$@" ;;
  esac
done

run=$(mktemp -d "\${TMPDIR:-/tmp}/seal-run.XXXXXX") || direct "$@"
# tmux starts panes with its server's environment, so the caller's travels in a file.
awk 'BEGIN {
  q = sprintf("%c", 39)
  for (k in ENVIRON) {
    if (k !~ /^[A-Za-z_][A-Za-z0-9_]*$/) continue
    v = ENVIRON[k]; out = ""
    while ((i = index(v, q)) > 0) { out = out substr(v, 1, i - 1) q "\\\\" q q; v = substr(v, i + 1) }
    print "export " k "=" q out v q
  }
}' >"$run/env" </dev/null
chmod 600 "$run/env"
tmux -L seal -f "$seal/tmux.conf" new-session -s "$name-$$" -c "$PWD" \\
  "$here/seal-run" "$run" "$PWD" "$real" "$@"
if [ ! -e "$run/started" ]; then
  rm -rf "$run"
  direct "$@"
fi
[ -s "$run/screen" ] && cat "$run/screen"
status=$(cat "$run/status" 2>/dev/null) || status=
rm -rf "$run"
case $status in
  '' | *[!0-9]*) exit 1 ;;
esac
exit "$status"
`
}

/** `seal-run RUNDIR CWD REAL ARGS...`: the pane half of seal-wrap. */
export function sealRunScript(): string {
  return `#!/bin/sh
if [ -z "\${SEAL_RUN_INNER:-}" ]; then
  exec env -i SEAL_RUN_INNER=1 TERM="\${TERM:-tmux-256color}" TMUX="\${TMUX:-}" \\
    TMUX_PANE="\${TMUX_PANE:-}" /bin/sh "$0" "$@"
fi
run=$1 cwd=$2 real=$3
shift 3
: >"$run/started"
term=$TERM tmux_socket=$TMUX tmux_pane=$TMUX_PANE
. "$run/env"
rm -f "$run/env"
TERM=$term TMUX=$tmux_socket TMUX_PANE=$tmux_pane
export TERM TMUX TMUX_PANE
unset SEAL_RUN_INNER
cd "$cwd" 2>/dev/null
"$real" "$@"
status=$?
echo "$status" >"$run/status"
# The pane closes with the agent, so keep its last screen (resume hints) for the caller's terminal.
tmux capture-pane -p -t "$TMUX_PANE" 2>/dev/null | awk 'NF { last = NR } { line[NR] = $0 } END { for (i = 1; i <= last; i++) print line[i] }' >"$run/screen"
exit "$status"
`
}

export function sealTmuxConf(): string {
  return `# Seal's private tmux server (tmux -L seal). Your own tmux server and ~/.tmux.conf are untouched.
set -g status off
set -g prefix None
set -g prefix2 None
unbind -a -T prefix
set -g mouse on
set -g history-limit 50000
set -g destroy-unattached on
set -g exit-empty on
set -g escape-time 0
if-shell 'infocmp tmux-256color' 'set -g default-terminal tmux-256color' 'set -g default-terminal screen-256color'
set -g set-titles on
set -g set-titles-string '#{pane_title}'
set -gq set-clipboard on
set -gq focus-events on
set -gq extended-keys on
set -gq allow-passthrough on
set -gaq terminal-features ',*:RGB'
set -gaq terminal-overrides ',*:Tc'
bind -T copy-mode MouseDragEnd1Pane send -X copy-pipe-and-cancel
bind -T copy-mode-vi MouseDragEnd1Pane send -X copy-pipe-and-cancel
`
}

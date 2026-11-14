import { sealRunScript, sealTmuxConf, sealWrapScript, WRAPPED_AGENTS } from './seal-wrap-scripts'

export type ShellIntegrationAction = 'install' | 'uninstall' | 'status' | 'enable' | 'disable'

export type ShellIntegrationStatus = {
  installed: boolean
  enabled: boolean
  /** `tmux -V` output, or null when tmux is missing. Wrapping needs tmux 3.0 or newer. */
  tmux: string | null
  rcFiles: string[]
}

export const RC_BLOCK_BEGIN = '# >>> seal shell integration >>>'
export const RC_BLOCK_END = '# <<< seal shell integration <<<'

function heredoc(path: string, body: string, mode: string): string {
  const fence = 'SEAL_SHELL_INTEGRATION_EOF'
  if (body.includes(fence)) {
    throw new Error('shell integration file contains its heredoc fence')
  }
  return `cat >"${path}.tmp" <<'${fence}'\n${body}${fence}\nchmod ${mode} "${path}.tmp" && mv -f "${path}.tmp" "${path}"\n`
}

function rcBlock(): string {
  const wrap = '"${XDG_CONFIG_HOME:-$HOME/.config}/seal/shell/seal-wrap"'
  // `function name {` (not `name()`) so an existing alias can't break the definition in bash or zsh.
  const functions = WRAPPED_AGENTS.map(
    (agent) => `  function ${agent} { ${wrap} ${agent} "$@"; }`
  ).join('\n')
  return `${RC_BLOCK_BEGIN}
# Runs claude/codex where Seal can message them. Remove with: seal shell-integration uninstall
if [ -x ${wrap} ]; then
${functions}
fi
${RC_BLOCK_END}`
}

/** One POSIX sh script per action, run with `sh -s` locally or over SSH. Prints one `@@SEAL` line. */
export function shellIntegrationScript(action: ShellIntegrationAction): string {
  const prelude = `set -e
dir="\${XDG_CONFIG_HOME:-$HOME/.config}/seal"
zrc="\${ZDOTDIR:-$HOME}/.zshrc"
begin='${RC_BLOCK_BEGIN}'
end='${RC_BLOCK_END}'
strip() {
  [ -f "$1" ] || return 0
  grep -qxF "$begin" "$1" || return 0
  awk -v b="$begin" -v e="$end" '$0 == b { skip = 1; next } $0 == e { skip = 0; next } !skip' "$1" >"$1.seal-tmp"
  # Rewrite in place so symlinked dotfiles stay symlinks.
  cat "$1.seal-tmp" >"$1" && rm -f "$1.seal-tmp"
}
status() {
  installed=0 enabled=0 rcs=
  [ -x "$dir/shell/seal-wrap" ] && installed=1
  [ $installed = 1 ] && [ ! -e "$dir/shell/disabled" ] && enabled=1
  for rc in "$zrc" "$HOME/.bashrc" "$HOME/.bash_profile"; do
    [ -f "$rc" ] && grep -qxF "$begin" "$rc" && rcs="$rcs $rc"
  done
  tmux=$(tmux -V 2>/dev/null) || tmux=none
  printf '@@SEAL installed=%s enabled=%s tmux=%s rc=%s\\n' "$installed" "$enabled" "$(echo $tmux | tr ' ' _)" "$(echo $rcs | tr ' ' :)"
}
`
  switch (action) {
    case 'install':
      return `${prelude}mkdir -p "$dir/shell"
${heredoc('$dir/shell/seal-wrap', sealWrapScript(), '755')}${heredoc('$dir/shell/seal-run', sealRunScript(), '755')}${heredoc('$dir/tmux.conf', sealTmuxConf(), '644')}rm -f "$dir/shell/disabled"
block=$(cat <<'SEAL_RC_EOF'
${rcBlock()}
SEAL_RC_EOF
)
targets=
{ [ -f "$zrc" ] || command -v zsh >/dev/null 2>&1; } && targets="$zrc"
{ [ -f "$HOME/.bashrc" ] || command -v bash >/dev/null 2>&1; } && targets="$targets $HOME/.bashrc"
[ -f "$HOME/.bash_profile" ] && targets="$targets $HOME/.bash_profile"
for rc in $targets; do
  strip "$rc"
  if [ -s "$rc" ] && [ -n "$(tail -c 1 "$rc")" ]; then echo >>"$rc"; fi
  printf '%s\\n' "$block" >>"$rc"
done
status
`
    case 'uninstall':
      return `${prelude}for rc in "$zrc" "$HOME/.bashrc" "$HOME/.bash_profile"; do strip "$rc"; done
rm -rf "$dir/shell" "$dir/tmux.conf"
rmdir "$dir" 2>/dev/null || true
status
`
    case 'enable':
      return `${prelude}rm -f "$dir/shell/disabled"\nstatus\n`
    case 'disable':
      return `${prelude}[ -d "$dir/shell" ] && : >"$dir/shell/disabled"\nstatus\n`
    case 'status':
      return `${prelude}status\n`
  }
}

export function parseShellIntegrationStatus(output: string): ShellIntegrationStatus | null {
  const line = /^@@SEAL (.*)$/m.exec(output)?.[1]
  if (!line) {
    return null
  }
  const fields = new Map(
    line
      .split(' ')
      .map((pair) => [pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1)])
  )
  const tmux = fields.get('tmux') ?? 'none'
  return {
    installed: fields.get('installed') === '1',
    enabled: fields.get('enabled') === '1',
    tmux: tmux === 'none' ? null : tmux.replaceAll('_', ' '),
    rcFiles: (fields.get('rc') ?? '').split(':').filter(Boolean)
  }
}

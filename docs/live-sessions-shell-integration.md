# Live sessions: shell integration

Seal can chat with Claude Code and Codex sessions you start in your own terminal, but only if it has
a way to type into them ([why](./live-sessions-input.md)). Out of the box that covers:

- Codex sessions (Seal queues the message with `codex queue`; no setup), and
- any session running inside tmux, and
- sessions started in a Seal pane.

Shell integration covers the rest: a Claude session started in a plain terminal tab. It makes the
`claude` and `codex` commands in zsh and bash run inside a private tmux server Seal can type into.

## Install

On this computer, either:

- **Settings › Agents › Shell integration on this computer › Install**, or
- `seal shell-integration install` in a terminal. (Inside Seal terminals the same CLI also runs as
  `orca`.)

Then open a new terminal tab, or run `exec $SHELL`.

On an SSH host:

- **Settings › SSH**, connect to the host, then **⋯ › Install shell integration**, or
- `seal shell-integration install --ssh <host>` from your machine, using your `~/.ssh/config`.

Requirements: macOS or Linux, zsh or bash, and tmux 3.0 or newer on the machine where the agent runs
(`brew install tmux`, `apt install tmux`, `dnf install tmux`). Without tmux the wrappers run the real
binary unchanged, and `status` reports it.

Other commands, all of which also take `--ssh <host>` and `--json`:

| Command                            | Effect                                                 |
| ---------------------------------- | ------------------------------------------------------ |
| `seal shell-integration status`    | Installed? Wrapping on? tmux version, rc files touched |
| `seal shell-integration disable`   | Keep it installed, but run `claude`/`codex` directly   |
| `seal shell-integration enable`    | Undo `disable`                                         |
| `seal shell-integration uninstall` | Remove everything below                                |

The **Let Seal message agents started in your terminal** switch in Settings › Agents runs
`disable`/`enable` on this computer and on every connected SSH host, including hosts that connect
later.

## What it installs

Everything lives in `${XDG_CONFIG_HOME:-~/.config}/seal/`:

| File              | Purpose                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------- |
| `shell/seal-wrap` | Decides whether to wrap, then starts the agent on Seal's tmux server                        |
| `shell/seal-run`  | Runs inside the tmux pane: restores your environment, runs the agent, records its exit code |
| `shell/disabled`  | Present while wrapping is switched off                                                      |
| `tmux.conf`       | Config for Seal's tmux server only                                                          |

It also adds this block to `~/.zshrc` (or `$ZDOTDIR/.zshrc`), `~/.bashrc`, and `~/.bash_profile`
if that file exists:

```sh
# >>> seal shell integration >>>
# Runs claude/codex where Seal can message them. Remove with: seal shell-integration uninstall
if [ -x "${XDG_CONFIG_HOME:-$HOME/.config}/seal/shell/seal-wrap" ]; then
  function claude { "${XDG_CONFIG_HOME:-$HOME/.config}/seal/shell/seal-wrap" claude "$@"; }
  function codex { "${XDG_CONFIG_HOME:-$HOME/.config}/seal/shell/seal-wrap" codex "$@"; }
fi
# <<< seal shell integration <<<
```

Installing again replaces the block instead of adding a second one. Uninstalling removes the block
and the files and leaves the rest of each rc file byte for byte as it was. Symlinked dotfiles stay
symlinks.

## How it behaves

`claude …` and `codex …` run as
`tmux -L seal -f ~/.config/seal/tmux.conf new-session -- <real binary> …` in the current directory.
On Seal's private server:

- no status bar and no prefix key, so every keystroke reaches the agent;
- mouse wheel scrolls tmux's 50,000-line history; drag to select, and the selection is copied to the
  system clipboard (OSC 52) when you release;
- truecolor, extended keys and focus events pass through; the window title follows the agent;
- the session ends when the agent exits or the terminal tab closes, and the server exits with its
  last session.

Your own tmux server, its sockets and `~/.tmux.conf` are never read or changed.

Arguments, the exit code, environment variables and the working directory pass through unchanged.
When the agent exits, its last screen (with the "resume this session with…" hint) is printed back in
your terminal.

The real binary runs directly, with no tmux, when:

- you are already inside tmux, or in a Seal pane;
- `SEAL_NO_WRAP=1` is set (`SEAL_NO_WRAP=1 claude …` for one run);
- wrapping is switched off;
- stdin or stdout is not a terminal (pipes, scripts, CI);
- the command prints and exits: `claude -p`, `--version`, `--help`, `claude mcp …`,
  `codex exec`, `codex review`, `codex login`, and the like;
- tmux is missing or older than 3.0.

An alias named `claude` or `codex` takes precedence over the function. Remove the alias or point it at
`seal-wrap` to keep wrapping.

## Taking a session over instead

For a session Seal can't type into, or to move one into Seal, the chat has **Take over**. It stops the
process (SIGTERM, then SIGKILL after 5 seconds; the pid must still be that agent) and reopens the
conversation in a Seal pane with `claude --resume <id>` or `codex resume <id>`, in a workspace on the
same machine.

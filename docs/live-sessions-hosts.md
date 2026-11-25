# Where live sessions look, and how they find a session

The live-session registry scans three kinds of machine. Each one is a `LiveSessionHost`: one POSIX
shell script in, its stdout back. Discovery, tmux sends, permission answers, `codex queue`,
transcript reads, take over and shell integration are all scripts, so every machine kind gets all of
them.

| Machine                                     | Host id                   | How a script runs                                  | Scanned every |
| ------------------------------------------- | ------------------------- | -------------------------------------------------- | ------------- |
| This computer (macOS, Linux)                | `local`                   | `/bin/sh -s`                                       | 3 s           |
| A connected SSH host (Settings › SSH)       | the SSH target id         | `sh -s` over the SSH connection                    | 8 s           |
| A paired server (Settings › Remote servers) | `runtime:<environmentId>` | `liveSessions.hostRun` on the server's runtime RPC | 8 s           |

A paired server is scanned while its last status check answered (`verification === 'verified'`) and
it isn't manually disconnected. Seal never starts a stopped WSL host or wakes a VM to scan it.
Windows servers and SSH hosts are skipped because the scan needs `ps`, tmux and a POSIX shell.

## `liveSessions.hostRun`

```ts
// params
{ script: string /* ≤ 256 KB */, timeoutMs?: number /* 1 000–120 000, default 20 000 */ }
// result
{ stdout: string /* capped at 3 MB, under the runtime's 4 MB response limit */ }
```

It has `workspace` permission, the same as `machineHost.*` and terminal creation, which already
run commands as the server's user. A server built before this method answers `method_not_found`.
The desktop then shows a host error in place of that server's sessions:
"_kessel-ml_ runs an older Seal: update Seal on this server to see and message its agent sessions".

## Finding a session

The script lists every `claude`/`codex` process. It matches `node …/cli.js` launches and Claude's
native `…/claude/versions/<version>` binary as well, and skips tool subcommands such as `mcp` or
`app-server`. A running process is always a live session, whatever its flags. It is paired with its
transcript, strongest evidence first:

1. **The session it names.** Claude's own registry (`~/.claude/sessions/<pid>.json`) or
   `--resume` / `-r` / `--session-id` / `codex resume <id>` on its command line.
2. **The transcript it owns.** A `.jsonl` it holds open (`/proc/<pid>/fd` on Linux, `lsof` for
   Codex on macOS), or the transcript SISomewhere's hook recorded for that pid.
3. **Its folder.** The newest transcript written in the same cwd. For Claude, that's the newest
   file in `~/.claude/projects/<cwd with every non-alphanumeric replaced by ->`.

Transcripts found these ways are **pinned**. They're listed and read ahead of the usual 12-hour
window and per-scan limits, so an agent started days ago and idle since still shows its title and
chat. Transcripts no running process owns are listed only if written in the last 12 hours, as
closed sessions.

## Coexisting with SISomewhere

SISomewhere installs `sisomewhere hook --provider … --wait` hooks in Claude and Codex settings and
keeps per-session state in `~/.config/sisomewhere/agents/<id>.json` (state, pid, transcript). Seal
only reads those files: their state is a status source, and their pid and transcript pin a session.
It never writes them or the hook settings. Tmux panes are found the same way SISomewhere finds them,
by the agent's tty on every tmux socket under `$TMUX_TMPDIR`, `/tmp` and `$TMPDIR`.

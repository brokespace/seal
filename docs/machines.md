# Machines

A **machine** is a computer Seal works on. This computer is always one. Every other machine connects to Seal in exactly one of two ways, and you choose which:

- **SSH**: Seal uses your SSH details (host, user, port, key, ProxyJump) and installs nothing on the machine.
- **Seal server**: Seal talks to a Seal server (`seal serve`) that you run on the machine and paired with a pairing link.

Every feature works the same either way:

- Machines tab: stats, files, transfers, previews and folder watching
- Live sessions: scan, send and answer
- Account push
- Terminals, agents and worktrees
- Open in editor
- Home overview and home-chat tools

The transport only shows as a small badge. A machine can store both sets of details; only the one you chose is used, so switching takes one click and the two never run at once.

## Record

Machines live in `seal-machines.json` in the user-data folder. Each record binds the two underlying stores:

| Field                     | Meaning                                                                                                                                                                    |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                      | Stable record id: the SSH target id for machines first saved as SSH hosts, the environment id for machines first paired as servers. Live-session ids and notes key off it. |
| `name`                    | Display name (rename in Settings → Machines).                                                                                                                              |
| `connection`              | `ssh` or `server`: the transport Seal uses.                                                                                                                                |
| `sshTargetId`             | The SSH host entry (SSH hosts store) holding the SSH config, or `null`.                                                                                                    |
| `environmentId`           | The paired server (`orca-environments.json`) holding the endpoint and pairing, or `null`.                                                                                  |
| `hostnames`, `machineIds` | What the host reported about itself (hostname, `/etc/machine-id` / `IOPlatformUUID` / `MachineGuid`), used to recognise one host saved twice.                              |

Split pairs are kept in `separations` (see below).

The SSH details and server pairing stay in their original stores and are never rewritten by this layer. Removing a machine removes its active transport's entry. If the machine also had the other transport, that one stays behind as a machine of its own.

Renderer and IPC code address a machine as `local` or `machine:<record id>`.

## Migration and merging

On every start, and whenever SSH hosts or servers change, `reconcileMachines` (`src/shared/machines/machine-reconcile.ts`) runs over the current SSH hosts and paired servers:

1. Existing records keep their ids, names and chosen connection. A record drops a link only if that SSH host or server was deleted, and drops out entirely when both are gone. Nothing is lost.
2. Each SSH host or server not yet in a record becomes its own machine. SSH hosts connect over SSH; servers connect via the Seal server.
3. An SSH-only machine and a server-only machine that are the same host merge into one. Matches are checked strongest first:
   - **linked**: the server is the one Seal deployed over that SSH host, or the one it tunnels to.
   - **machine id**: both transports reported the same OS machine id. If both reported ids and they differ, they never merge.
   - **address**: the SSH host and the server endpoint name the same address. Loopback endpoints (tunnels) and relay addresses shared by several servers are ignored.
   - **hostname**: the short hostnames match (`kessel-ml.tail9f2.ts.net` and `kessel-ml`).

   A match that two candidates contest equally is left alone.

A merged machine keeps the SSH record's id and name, **connects via the Seal server**, and keeps the SSH details for switching.

Identity is probed once per machine and transport after it connects, so hosts whose names don't match still merge once both report the same machine id.

**If Seal merged two different hosts**, use **These are different machines — split** in Settings → Machines. Split pairs are remembered and never merged again automatically.

### Example: kessel-ml

Brian had `kessel-ml` as an SSH host (`brian@kessel-ml.<tailnet>.ts.net`) and as a paired Seal server (`ws://100.x.y.z:6768`, which reports the machine name `kessel-ml`). The first launch on this version gives:

- **One machine** named `kessel-ml`, with the SSH host's id, so existing live-session ids stay valid.
- It connects **via the Seal server**.
- The SSH host entry stays stored, so **SSH** on its row in Settings → Machines switches it over in one click.
- Both underlying entries are untouched, so going back to an older Seal build still finds both.

The merge reason is `hostname`; it becomes `machine-id` once both transports have reported their OS machine id.

## Connections

Main code reaches a machine only through `MachineRegistry.connection(machineId)` (`src/main/machines/registry/`), which returns a `MachineConnection` (`src/main/machines/connection/machine-connection.ts`):

```ts
type MachineConnection = {
  machineId; transport: 'local' | 'ssh' | 'server'
  isConnected(); connect(); dialect(): 'posix' | 'powershell'
  exec(script, { timeoutMs, cwd?, stdin?, signal? })
  files: MachineFileSystem   // list/stat/read/write/rename/remove, transfers, URL download, watch
  metrics(); identity()
  openShell({ cols, rows, cwd?, command? }, { onData, onExit })
}
```

|         | SSH (`SshMachineConnection`)                                   | Seal server (`ServerMachineConnection`)             |
| ------- | -------------------------------------------------------------- | --------------------------------------------------- |
| exec    | the SSH exec channel (PowerShell `-EncodedCommand` on Windows) | `machineHost.exec` RPC                              |
| files   | SFTP, or shell commands for system-ssh hosts                   | `machineHost.*` chunked RPCs                        |
| watch   | `inotifywait` on the host, otherwise polling                   | `machineHost.watch` stream (`fs.watch` on the host) |
| shell   | ssh2 PTY channel, or the `ssh` binary in a local PTY           | `machineHost.shell` stream (PTY on the host)        |
| metrics | POSIX / PowerShell probe scripts                               | `machineHost.metrics`                               |

A machine set to SSH connects directly, through `setDirectSshConnectPolicy` in `ssh-connect-flow.ts`: Seal does not deploy or pair a server over it. A machine set to Seal server never opens an SSH session. In the renderer, switching transport disconnects the old one before connecting the new one.

Features built on the interface:

| Feature                                                           | Code                                                                            |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Machines tab (stats, files, transfers, previews, watchers)        | `src/main/machines/machine-ipc.ts`                                              |
| Terminals and agents                                              | `src/main/machines/shell/machine-shell-ipc.ts`, `work/machine-agent-launch.ts`  |
| Worktrees                                                         | `src/main/machines/work/machine-worktrees.ts`                                   |
| Live-session scan and input                                       | `src/main/live-sessions/hosts/live-session-hosts.ts` (`machineLiveSessionHost`) |
| Home chat (`list_machines`, `run_command`, file tools, transfers) | `src/main/home-chat/machines/home-chat-unified-machine.ts`                      |
| Account push                                                      | `src/main/seal-accounts/seal-desktop-fleet-transport.ts`                        |

A live-session scan is the same script either way. A server-connected machine runs it with the server's own `liveSessions.hostRun`, which is skipped while that server is unverified, disconnected or on Windows. An SSH machine runs it as `sh -s` over exec. Session ids use the machine's record id, so they stay the same when the transport is switched.

VM hosts that Colima, Lima and OrbStack write into `~/.ssh/config` are not machines.

Account push works on both transports. A Seal server gets the swap policy and the logins over RPC. An SSH machine gets each login installed where the CLI reads it:

- `~/.codex/auth.json`
- `~/.claude/.credentials.json` and `~/.claude.json`
- on a Mac, the login Keychain item `Claude Code-credentials`

An older login never replaces a fresher one already on the machine.

Workspaces in the sidebar keep their execution host id: `ssh:<target>` for SSH, `runtime:<environment>` for a server. New workspaces, agent launches and live-session take-over use the machine's active transport.

## Settings

Settings → **Machines** replaces the old _SSH Hosts_ and _Remote Seal Servers_ sections on desktop. Old deep links to either one land here. The browser client, which can only reach servers, keeps its Servers section.

- **Add machine** offers **Connect over SSH…** (the SSH host form, including "fill from SSH config") or **Connect via Seal server (pairing link)…**.
- Each row shows the stored SSH and server details and an **SSH / Seal server** switch. Its menu has **Rename**, **Add SSH details…** / **Pair a Seal server…** (stores the other transport without switching to it) and **split**.
- **SSH keys, port forwards and server pairing** expands the full SSH host and server settings: editing, port forwards, generating pairing links, and running this computer as a server.

## Known limits

- An SSH machine has no resident Seal, so account auto-swap and fleet policy run only on Seal servers. Pushed logins still land in the CLI's own files.
- On a Mac reached over SSH, installing the Claude login needs that Mac's login Keychain to be unlocked.
- **Open in editor** runs on this computer and reaches the machine over SSH (VS Code or Cursor Remote-SSH, or Zed), so it needs stored SSH details whichever transport Seal uses. A server-only machine offers **Add SSH details**, which stores them without leaving the server connection.
- VS Code and Cursor take a custom SSH port only from a `Host` entry in `~/.ssh/config`. Seal uses a matching entry when one exists and otherwise offers to copy one.
- Windows machines are not scanned for live sessions: there is no `ps`/tmux to read.
- The assistant's supervised subagents (`spawn_subagent` in agent mode) need a machine connected over SSH or this computer. On a server-connected machine the assistant uses `start_session` instead.

## Tests

| Test                                                             | Covers                                                                                                                                    |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `src/shared/machines/machine-reconcile.test.ts`                  | Migration, merge reasons, relay and machine-id guards, splits, deletions, kessel-ml                                                       |
| `src/main/machines/registry/machine-registry.test.ts`            | Routing by connection type, switching, identity merges, adding a transport                                                                |
| `src/main/machines/connection/machine-connection-parity.test.ts` | One feature suite run against both transports on this host, through a loopback SSH link and the in-process `machineHost` runtime handlers |

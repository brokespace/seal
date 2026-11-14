# Seal as an MCP server

Seal exposes itself over the [Model Context Protocol](https://modelcontextprotocol.io) so an
assistant that lives outside Seal — Claude Code, Codex, Cursor, or a cloud assistant that is only
given a URL — can drive it: list machines, run commands, read and write files, list, read, message,
start and stop agent sessions, and read accounts, usage, projects, workspaces and skills.

The server runs inside every Seal host process: the desktop app and the headless server
(`seal serve`). It is off the network until you turn a network transport on, and it has no clients
until you create one.

- [Set it up](#set-it-up)
- [Transports](#transports)
- [Connect a client](#connect-a-client)
- [Tools and scopes](#tools-and-scopes)
- [Clients, approvals, limits and the audit log](#clients-approvals-limits-and-the-audit-log)
- [Threat model](#threat-model)
- [How it is built](#how-it-is-built)

## Set it up

In the desktop app: **Settings → MCP**. The page shows the endpoint URLs, the clients and their
scopes, the audit log, and copy-paste configuration for each client. It can manage this computer or
a paired Seal server.

On a headless server, or from a terminal:

```bash
seal mcp token create --name "Claude Code" --scopes read,sessions   # prints the token once
seal mcp status                                                     # where the server is reachable
seal mcp enable http                                                # serve /mcp on Seal's own port
seal mcp enable relay                                               # public HTTPS URL through the relay
seal mcp machines                                                   # machine ids for --machines
seal mcp token list
seal mcp token revoke <id>
seal mcp audit --limit 100
seal mcp approvals && seal mcp approve <id>                         # or: seal mcp deny <id>
```

Add `--environment <id>` to any of these to manage a paired Seal server from your own computer.
`seal mcp token create` takes `--scopes`, `--machines <id,id>`, `--approval never|destructive|commands`,
`--allow-relay` and `--rate <calls-per-minute>`. Machine ids are the ones `seal mcp machines` and
the `list_machines` tool print: `local` for the Seal host itself, `machine:<id>` for a machine from
the Machines page.

A token looks like `smcp_<12 hex>_<43 characters>`. It is shown once. Seal stores a SHA-256 hash of
it in `<userData>/mcp/clients.json` (mode 0600) and can never show it again.

## Transports

| Transport       | Address                                          | On by default | Who can reach it                                   | Encryption                                                |
| --------------- | ------------------------------------------------ | ------------- | -------------------------------------------------- | --------------------------------------------------------- |
| stdio           | `seal mcp`                                       | yes           | a process on a computer that runs or pairs to Seal | local socket, or the end-to-end encrypted pairing channel |
| Streamable HTTP | `http://<address>:<port>/mcp`                    | no            | whatever can reach Seal's port (LAN, tailnet)      | none: plain HTTP                                          |
| Relay           | `https://relay.seal.wotarmelon.com/mcp/<hostId>` | no            | anyone on the internet, with a token               | TLS to the relay; the relay can read it                   |

All three speak the same server: same tokens, same tools, same rules. Protocol versions
`2025-11-25`, `2025-06-18`, `2025-03-26` and `2024-11-05` are accepted.

### stdio: `seal mcp`

`seal mcp` reads one JSON-RPC message per line on stdin and answers on stdout; diagnostics go to
stderr. The token comes from the `SEAL_MCP_TOKEN` environment variable. The process holds no tools
or state: it hands each message to the Seal server it is connected to (`sealMcp.message`) and
prints the reply.

With `--environment <id>` it drives a paired Seal server instead of the local one, over the same
encrypted channel the rest of the CLI uses for that server. This is the transport to use when a
client on another computer can run a local command: **nothing between the client and the server can
read or change the calls.**

### Streamable HTTP on the Seal server

`seal mcp enable http` (or the switch in Settings) serves `/mcp` on the port Seal already listens
on, `6768` unless you changed it. It is the stateless form of MCP's Streamable HTTP transport:

- `POST /mcp` with `Authorization: Bearer <token>` and a JSON-RPC body. Answers are JSON; a
  `tools/call` from a client that accepts `text/event-stream` is answered as an event stream, with
  keep-alive comments while the call waits (for approval, or for a long command).
- There are no sessions and no server-initiated stream: `GET` answers `405`.
- No or wrong token: `401` with `WWW-Authenticate: Bearer`. Transport switched off: `404`. A request
  whose `Origin` is another site: `403`, so a web page cannot drive the server from a browser.
- Bodies are limited to 4 MiB.

It is plain HTTP. Use it on a network you trust, or inside a tailnet. Seal's existing source rules
for its port apply to `/mcp` as well.

### Remote: through the Seal relay

A cloud assistant can only be given an HTTPS URL. `seal mcp enable relay` gives the server one:

```
https://relay.seal.wotarmelon.com/mcp/<hostId>
```

`<hostId>` is the fingerprint of the server's pairing key, so the server needs to have paired with
a device once. The server dials **out** to the relay over a WebSocket and proves it owns that key
(the same sealed challenge it uses for push). The relay passes each public request down that socket
and streams the answer back. Nothing listens on your network, and no port is opened.

Only clients created with **Allow through relay** (`--allow-relay`) can use this URL.

> **The relay terminates TLS for this path.** A client that holds nothing but a URL and a bearer
> token cannot do end-to-end encryption with your server: something on the internet has to accept
> its HTTPS connection, and that something can read the request. So, unlike device pairing, the
> relay **can read** MCP requests and responses that pass through it, including the client token,
> and a compromised relay could replay that token. See [the threat model](#the-relay) for what that
> allows and how Seal limits it. If your client can run a local command, use
> `seal mcp --environment <id>` instead; if you want a public URL without trusting the relay, point
> a TLS-passthrough tunnel you control (for example Tailscale Funnel, or a reverse proxy with your
> own certificate) at the HTTP endpoint and leave the relay off.

The relay is not deployed yet. Deploying `cloud/seal-relay` adds a Durable Object class
(`SealMcpTunnel`, migration `v2`) and a rate-limit binding (`MCP_LIMITER`); see
`cloud/seal-relay/deploy.md`. Limits on this path: request bodies up to 512 KiB, 32 requests in
flight per server, 300 requests a minute per source address per server, and 180 seconds for the
server to start answering (an answer that has started, such as a call waiting on approval, streams
for as long as it needs).

## Connect a client

Settings → MCP → **Connect a client** fills these in for you. Replace `<token>` and the URL.

**Claude Code**

```bash
claude mcp add seal --env SEAL_MCP_TOKEN=<token> -- seal mcp                                   # stdio
claude mcp add --transport http seal <url> --header "Authorization: Bearer <token>"            # HTTP or relay
```

**Codex** (`~/.codex/config.toml`)

```toml
[mcp_servers.seal] # stdio
command = "seal"
args = ["mcp"]
env = { SEAL_MCP_TOKEN = "<token>" }

[mcp_servers.seal] # HTTP or relay; export SEAL_MCP_TOKEN=<token>
url = "<url>"
bearer_token_env_var = "SEAL_MCP_TOKEN"
```

**Cursor** (`~/.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "seal": { "command": "seal", "args": ["mcp"], "env": { "SEAL_MCP_TOKEN": "<token>" } }
  }
}
```

```json
{
  "mcpServers": {
    "seal": { "url": "<url>", "headers": { "Authorization": "Bearer <token>" } }
  }
}
```

**Any HTTP client**

```bash
curl -sS <url> \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

**A cloud assistant** (once the relay is deployed):

1. On the Seal server: `seal mcp enable relay`, then
   `seal mcp token create --name assistant --scopes read,sessions --allow-relay` (add scopes and
   `--machines` as needed).
2. `seal mcp status` prints the relay URL and whether the server is connected to it.
3. Give the assistant the URL as a remote MCP server (Streamable HTTP) and the token as its bearer
   / authorization token. The client must be able to send an `Authorization` header: Seal does not
   accept tokens in the URL, because URLs end up in logs.

Clients that can only sign in with OAuth cannot connect yet; see [OAuth](#oauth).

## Tools and scopes

A tool needs **every** scope it lists. A tool the token is not scoped for is not in `tools/list`
and calling it answers "This MCP client has no tool …", the same as a tool that does not exist.
Anything not listed here is not reachable over MCP.

| Tool                                                                 | Scopes                     | What it does                                                     |
| -------------------------------------------------------------------- | -------------------------- | ---------------------------------------------------------------- |
| `list_machines`                                                      | `read`                     | Every machine Seal can reach, with its id and status             |
| `list_sessions`, `read_session`                                      | `read`                     | Agent sessions on any machine, and a session's transcript        |
| `account_usage`                                                      | `read`                     | Claude and Codex accounts with their usage and limits            |
| `list_projects`, `list_workspaces`                                   | `read`                     | Projects and workspaces (`repo.list`, `worktree.list`)           |
| `list_skills`, `load_skill`                                          | `read`                     | Skills installed on a machine                                    |
| `message_session`, `start_session`                                   | `sessions`                 | Send a message to a session; start a new agent session           |
| `stop_session`                                                       | `sessions` + `destructive` | Stop a running session; it stays listed with its transcript      |
| `read_file`, `write_file`, `transfer_file`                           | `files`                    | Read, write, and copy files on and between machines              |
| `delete_path`                                                        | `files` + `destructive`    | Delete a file or folder                                          |
| `run_command`, `job_status`, `job_output`, `job_kill`, `job_cleanup` | `commands`                 | Run a shell command (optionally in the background) and follow it |
| `switch_account`                                                     | `destructive`              | Change which account new sessions use                            |

`run_command` also needs `destructive` when Seal's risk check flags the command (for example `rm`,
`git push --force`, `git reset --hard`, `kill`, `shutdown`, `npm publish`, a `curl` that sends
data). The check is a pattern match on the command text. It catches obvious cases and is trivially
avoided by a client that wants to avoid it; it is not a sandbox.

These are the Home assistant's own tools (`src/main/home-chat/tools`) and Seal's RPC methods,
called in-process. The MCP server adds no second implementation of any of them.

## Clients, approvals, limits and the audit log

**Scopes** — `read`, `sessions`, `files`, `commands`, `destructive`. Default deny: a new client has
only what you tick.

**Machine allowlist** — a client can be limited to some machines. Tools that take a machine are
refused for any other; lists of machines, sessions, projects and workspaces are filtered to the
allowed machines; `start_session` only starts in a project or workspace on an allowed machine; a
background job can only be followed by the client that started it. Account tools (`account_usage`,
`switch_account`) act on the Seal host as a whole and are not narrowed by the allowlist.

**Approval** — per client:

- `never`: calls run without asking.
- `destructive` (default): destructive calls wait for a person.
- `commands`: every command waits as well.

Over the relay, destructive calls **always** wait, whatever the client's policy says. A waiting
call belongs to the Seal server that received it, and is answered there: in the desktop app (a
prompt on any screen for the app's own server, and Settings → MCP for it or for a paired server
picked there), on a paired phone (Seal → MCP approvals, with a notification), or with
`seal mcp approvals`. A headless server has no desktop prompt of its own, so its calls are answered
from the phone, from Settings → MCP on a desktop paired with it, or from the CLI. The prompt names
the client, the transport, the tool, the machine and the arguments. A call that is not answered in
120 seconds is declined. A client can have 5 calls waiting at most. Revoking a client declines what
it has waiting and stops its calls in progress.

**Rate limits** — each client has a calls-per-minute budget (120 by default); beyond it, calls
answer a JSON-RPC error until the budget refills. A source that presents bad tokens is locked out
after 20 failures in a minute (`429`). The relay additionally limits each source address per host
and holds at most 32 requests in flight per host.

**Audit log** — every request except `ping` and notifications is recorded in
`<userData>/mcp/audit.jsonl` and shown in Settings → MCP and `seal mcp audit`: time, client,
transport, peer address, tool, machine, a summary of the arguments, the outcome
(`ok`, `error`, `unauthorized`, `scope-denied`, `machine-denied`, `approval-denied`,
`rate-limited`), whether it was approved, and how long it took. Failed sign-ins are recorded too.

**Secrets stay out of logs** — tokens are never written anywhere: not to the client file (only the
hash), not to the audit log, not to Seal's logs. In the audit log, file contents, message text and
prompts are recorded as a length, argument values pass through Seal's secret redaction, and tool
output is never stored. Approval notifications name the client, tool and machine, not the
arguments.

## Threat model

What is being protected: the machines Seal can reach, the files and credentials on them, your agent
sessions and accounts.

### What a token is worth

Treat scopes as what they allow at worst, not at best:

- `commands` is a shell as your user on every allowed machine. A client with it can read anything
  you can read (including other credentials and Seal's own files), install software, and use the
  `seal` CLI on that machine to create more tokens or approve its own calls. Approval prompts and
  the `destructive` check slow a careless or confused assistant; they do not contain a hostile one.
  Give `commands` only to a client you would give an SSH key to, limit it to the machines it needs,
  and prefer the `commands` approval policy.
- `files` can read any file your user can read on allowed machines — SSH keys and cloud
  credentials included — and write any file your user can write, which is a path to running code.
- `sessions` can instruct agents that themselves run commands. It is narrower than `commands`
  only as far as those agents' own permission settings make it.
- `read` discloses machine names and addresses, session transcripts (which may contain secrets that
  appeared in a session), account emails and usage, project and workspace paths.

The machine allowlist is enforced by Seal before a tool runs. It is not enforced by the machines:
a client with `commands` on machine A can `ssh` from A to wherever A's user can.

### stdio

Local `seal mcp` talks to Seal over the owner-only local socket, so anything that can run it
already runs as you. The token still decides what the MCP client gets, which is what keeps a
read-only assistant read-only. With `--environment`, calls travel over the paired, end-to-end
encrypted channel; a network attacker or the relay sees ciphertext.

### HTTP on the LAN

No transport encryption. Anyone who can observe the traffic can read requests and responses and
capture the token; anyone who can reach the port can try tokens (guessing a 256-bit secret is not
practical, and failed sign-ins are throttled and logged). Cross-site browser requests are refused.
Keep it off, or behind a tailnet or TLS proxy, on a network you do not control.

### The relay

The relay is built to be a forwarder that decides nothing:

- It keeps no client tokens, no state about clients, no request or response bodies, and its code
  writes none of them to logs. (Whoever operates the Worker should leave Cloudflare's Workers Logs
  and Logpush off for it, or accept that Cloudflare records request metadata such as the URL, which
  contains the host id, and the source address.) It checks only that a request carries something shaped like a Seal token (to
  drop junk without waking the server), applies rate limits, and forwards an allowlisted set of
  headers and the body. **The server alone** authenticates the token, checks scopes and the machine
  allowlist, asks for approval, and writes the audit log.
- Only the holder of a server's pairing key can claim that server's URL. One server cannot answer
  for another, and a client token means nothing to any server but the one that issued it.
- The server marks every relayed call as `relay` in the audit log and applies stricter rules to it:
  the client must be allowed to use the relay, and destructive calls always wait for approval.

What that does and does not buy:

| An attacker who…                                                          | can                                                                                                                                                                    | cannot                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| is on the network between client and relay                                | nothing: it is TLS                                                                                                                                                     | read or change requests                                                                                                                                                                                                                                                                                                              |
| knows the URL but has no token                                            | send requests that are refused (and rate limited)                                                                                                                      | reach any tool; learn whether a token guess was close                                                                                                                                                                                                                                                                                |
| **controls the relay** (or Cloudflare, or the relay's deploy credentials) | read relayed requests and responses; capture a relayed token and replay it; alter or forge requests **within that token's scopes and machines**; drop or delay traffic | use a token that has not passed through it; exceed a token's scopes or machine allowlist; make a destructive call without a person approving it in Seal; approve its own calls (approvals travel over the end-to-end encrypted device channel, not this path); touch a server whose relay access is off; read device pairing traffic |

So the trust placed in the relay is: confidentiality and integrity of relayed MCP traffic, bounded
by the scopes of the tokens you allow through it. Keep that bound small: leave relay access off
unless you need it, allow it per client, give relayed clients the fewest scopes and machines they
can work with, and think hard before giving a relayed client `commands` or `files`. A relayed
`commands` token in the hands of a compromised relay is a shell on your machines, one approval
prompt at a time for anything flagged destructive, and none at all for the rest unless the client's
policy is `commands`.

Removing that trust needs the client to hold a key and encrypt to the server, which a URL-and-token
client cannot do. `seal mcp --environment` does exactly that for clients that can run a command.

### OAuth

Clients authenticate with bearer tokens created in Seal. OAuth 2.1 (the MCP authorization spec:
protected-resource metadata, dynamic client registration, PKCE) is not implemented, so a cloud
client that insists on OAuth sign-in cannot connect yet. The design leaves room for it without
changing who is trusted: the Seal server would be the authorization server and show consent in the
app, and the relay would forward `/.well-known/*` and the token endpoints as blindly as it forwards
`/mcp`. OAuth would not stop the relay from reading traffic; only sender-constrained tokens (DPoP)
with a client that supports them would stop replay.

### Other things worth knowing

- Revocation is immediate: the token stops working, waiting approvals are declined, calls in
  progress are stopped. A command already started on a machine may have had effects.
- A paired phone can see and answer approvals. It cannot create, list or change clients or read the
  audit log.
- Managing clients (`sealMcp.*` except `sealMcp.message`) needs host-admin: this machine's own user
  or a paired Seal desktop. An MCP client has no tool for it — but see `commands` above.
- The approval prompt shows what the client asked for, not what the command will do. Read it.

## How it is built

```
MCP client ── stdio ── seal mcp ── sealMcp.message (runtime RPC) ─┐
MCP client ── HTTP ─── POST /mcp on Seal's port ──────────────────┤
MCP client ── HTTPS ── relay Worker ── Durable Object ══ WebSocket ┤   (server dials out)
                                                                  ▼
                                              SealMcpService (one per host process)
                               admission → rate limit → scope → machine allowlist → approval → audit
                                                                  ▼
                                     Home assistant tools  +  Seal RPC methods (in-process)
```

| Piece                                     | Where                                                                                          |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------- |
| JSON-RPC / MCP core                       | `src/main/seal-mcp/protocol/mcp-json-rpc-server.ts` (shared with the Codex home-chat endpoint) |
| Service: tokens, scopes, approvals, audit | `src/main/seal-mcp/`                                                                           |
| Tool catalog and scopes                   | `src/main/seal-mcp/tools/seal-mcp-tool-catalog.ts`                                             |
| Runtime RPC methods (`sealMcp.*`)         | `src/main/runtime/rpc/methods/mcp/seal-mcp-methods.ts`                                         |
| HTTP endpoint                             | `src/main/seal-mcp/http/`                                                                      |
| Relay tunnel, server side                 | `src/main/seal-mcp/relay/`                                                                     |
| Relay tunnel, Worker side                 | `cloud/seal-relay/src/seal-mcp-routes.ts`, `seal-mcp-tunnel.ts`                                |
| CLI                                       | `src/cli/mcp/`                                                                                 |
| Settings page and approval prompt         | `src/renderer/src/components/settings/mcp/`, `src/renderer/src/components/seal-mcp/`           |
| Phone approvals                           | `mobile/src/seal/mcp-approvals/`                                                               |

Tests use the official SDK client (`@modelcontextprotocol/sdk`) against all three transports:
`src/main/seal-mcp/stdio/seal-mcp-stdio-conformance.test.ts` (spawns the stdio server),
`src/main/seal-mcp/http/seal-mcp-http-conformance.test.ts`, and
`cloud/seal-relay/test/seal-mcp-relay.test.ts` (the relay Worker in Miniflare, with a real host
tunnel). Authentication, scopes, the machine allowlist, approvals, revocation and rate limits are
covered in `src/main/seal-mcp/seal-mcp-service.test.ts`.

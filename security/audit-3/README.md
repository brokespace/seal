# Audit 3 — attack scripts

Attack scripts for the pentest report in
[`docs/security/audit-3-pentest.md`](../../docs/security/audit-3-pentest.md). They now double as
regression tests: each `relay/*.mjs` check asserts the **hardened** Worker's fixed behaviour and
reports `blocked`. A check that still sees exploitable behaviour reports `VULNERABLE` and the script
exits non-zero; an accepted, documented residual reports `info` with a one-line reason. The Worker's
vitest suite runs them against the real Worker on every test run (see "In the test suite" below).

**These are offensive test tools. Run them only against a local, throwaway relay and your own local
`orcad`.** They never touch production, never deploy, and use generated (non-production) secrets.

## Layout

- `lib/` — shared harness
  - `local-relay.mjs` — starts the `seal-relay` Worker locally via `wrangler`'s `unstable_startWorker`
    (Miniflare/`workerd`) with throwaway ES256/APNs secrets, a pool of enrolled host keys
    (`HOST_ALLOWLIST`), and a fake push provider that logs every request. Flags: `--port`,
    `--state-dir`, `--hosts N` (size of the enrolled pool, default 64), `--expose-operator-secrets`,
    `--splice-idle-timeout-ms N` (shorten the 10 min splice idle timeout; `07` needs it), and
    `--no-ratelimits` (drop the Rate Limiting bindings so the routes they guard refuse with `429`).
  - `relay-protocol.mjs` — a from-scratch client for the relay wire protocol (host sessions, relay
    JWT, control/phone/data sockets, invites, splices). `report()` prints one JSON verdict per check
    and sets a non-zero exit code on `VULNERABLE`; `finish()` exits with it.
  - `relay-state.mjs` — reads/writes the files a running relay leaves in the state dir (see below),
    shared by `local-relay.mjs`, the scripts and the vitest suite.
  - `deps.mjs` — resolves `ws`/`tweetnacl`/`jose`/`wrangler` from the relay's `node_modules`.
- `relay/` — attacks against the relay Worker (run with the local relay up)
  - `01-unauth-upgrades-and-routes.mjs` — JWT forgery, header spoofing, admin/traversal routes.
  - `02-host-oracle-and-preauth-storage.mjs` — host-liveness oracle, DO storage amplification, /64 bypass.
  - `03-credential-bruteforce.mjs` — rate limiting, pipelining, invite lockout.
  - `04-replay.mjs` — session/proof/connTicket/invite/resume replay and revoke behaviour.
  - `05-cross-tenant.mjs` — open-relay enrolment and cross-tenant isolation.
  - `06-malformed-and-oversized.mjs` — HTTP body/path and WebSocket frame/RPC fuzzing.
  - `07-slowloris-and-flood.mjs` — slowloris, connection flood, idle timeout, Worker-cost burn.
  - `08-push-abuse.mjs` — push endpoint abuse, quota rotation, token hijack, SSRF checks.
- `orcad/` — attacks against the headless server
  - `01-preauth-and-pairing.mjs` — pre-auth HTTP/WS/RPC surface, header spoofing, pairing brute-force
    entropy, lockout probe. Point it at a local `orcad` with `ORCAD_URL`.

## Running

```bash
# 1. start a throwaway relay (127.0.0.1:8787) with generated secrets + fake push provider
node security/audit-3/lib/local-relay.mjs --expose-operator-secrets --splice-idle-timeout-ms 3000
# 2. in another shell, run any attack script
node security/audit-3/relay/02-host-oracle-and-preauth-storage.mjs
```

The relay writes its state (default `/tmp/seal-audit3`, override with `--state-dir`) for the scripts
to read: `relay.json` (origin, persist dir, push-request log), `enrolled-hosts.json` (the key pool,
mode 600; each key is handed to one script run via a cursor in `enrolled-hosts.next`), and, with
`--expose-operator-secrets`, `operator-secrets.json` (mode 600, for the "malicious operator" checks).
A script finds the relay with `SEAL_AUDIT_RELAY_ORIGIN` or `relay.json`; set `SEAL_AUDIT_STATE_DIR`
to point both at a non-default state dir. Restart the relay when the enrolled pool is exhausted.

## In the test suite

`cloud/seal-relay/test/security/audit-3-relay-attacks.test.ts` runs every `relay/*.mjs` against the
real Worker in local `workerd` (one `it` per script), asserting each exits 0 with no `VULNERABLE`
line. It starts its own relay via the Worker harness, so no local relay is needed:

```bash
cd cloud/seal-relay && pnpm exec vitest run test/security/audit-3-relay-attacks.test.ts
```

For the `orcad` script, start a local server with no `--bind` (so the loopback default is what
gets probed) and set `ORCAD_URL`. The lockout probe also needs the host public key, which is the
`publicKeyB64` inside the pairing URL the server prints:

```bash
ORCA_SERVE_RUNTIME=orcad <orcad-node-build>/orcad --port 6768
ORCAD_URL=http://127.0.0.1:6768 ORCAD_HOST_PUBLIC_KEY_B64=<publicKeyB64> \
  node security/audit-3/orcad/01-preauth-and-pairing.mjs
```

Expected on a fixed build: `listener reachable beyond loopback` is `blocked`, and
`lockout after repeated wrong device tokens` is `blocked` at the fourth attempt (close code 1013).
Pairing-offer and device-token expiry cannot be probed without a credential; the host's unit tests
cover them (`src/main/runtime/rpc/server/pairing/device-credential-lifetime.test.ts`).

Each check prints a line like
`{"check":"…","verdict":"blocked|VULNERABLE|info|skipped", …}`. `verdict` is this harness's
assessment, not a product output.

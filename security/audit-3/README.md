# Audit 3 — attack scripts

Working proof-of-concept scripts for the pentest report in
[`docs/security/audit-3-pentest.md`](../../docs/security/audit-3-pentest.md).

**These are offensive test tools. Run them only against a local, throwaway relay and your own local
`orcad`.** They never touch production, never deploy, and use generated (non-production) secrets.

## Layout

- `lib/` — shared harness
  - `local-relay.mjs` — starts the `seal-relay` Worker locally via `wrangler`'s `unstable_startWorker`
    (Miniflare/`workerd`) with throwaway ES256/APNs secrets and a fake push provider that logs every
    request. Flags: `--port`, `--state-dir`, `--expose-operator-secrets`, `--no-ratelimits`.
  - `relay-protocol.mjs` — a from-scratch client for the relay wire protocol (host sessions, relay
    JWT, control/phone/data sockets, invites, splices). `report()` prints one JSON verdict per check.
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
node security/audit-3/lib/local-relay.mjs --expose-operator-secrets
# 2. in another shell, run any attack script
node security/audit-3/relay/02-host-oracle-and-preauth-storage.mjs
```

For the `orcad` script, start a local server (loopback) and set `ORCAD_URL`:

```bash
ORCA_SERVE_RUNTIME=orcad <orcad-node-build>/orcad --bind 127.0.0.1 --port 6768 --mobile-pairing
ORCAD_URL=http://127.0.0.1:6768 node security/audit-3/orcad/01-preauth-and-pairing.mjs
```

Each check prints a line like
`{"check":"…","verdict":"blocked|VULNERABLE|info|skipped", …}`. `verdict` is this harness's
assessment, not a product output.

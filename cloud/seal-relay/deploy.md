# Deploying the Seal relay and push Worker

One Worker (`seal-relay`) serves both hostnames:

| Hostname                    | Role                                                                                                                                                                                                 |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `relay.seal.wotarmelon.com` | Relay director (`/v1/assign`, `/v1/resolve`), relay token mint (`/v1/host/relay-token`), host control and phone/data WebSockets (`/v1/host/control`, `/v1/connect/:hostId`, `/v1/host/data/:connId`) |
| `push.seal.wotarmelon.com`  | Host auth (`/v1/host/challenge`, `/v1/host/session`) and push (`/v1/devices`, `/v1/send`)                                                                                                            |

Both hostnames route to the same code. Desktops (Electron and `seal serve`/orcad) default to these origins. You can override them per machine with `SEAL_RELAY_URL` and `SEAL_PUSH_URL`.

## What you need

- A Cloudflare account where `wotarmelon.com` is an active zone. Durable Objects with SQLite storage and the Rate Limiting binding are both available on the Workers Free plan.
- Your Cloudflare account ID (Dashboard → Workers & Pages → right sidebar).
- Node 22+ and pnpm.
- An APNs auth key for iOS push: a `.p8` file, its Key ID, and your Apple Team ID (see `docs/seal-mobile-ios.md`).
- Optional, for Android push: a Firebase service-account JSON for the project in `mobile/google-services.json`.

## Steps

```bash
cd cloud/seal-relay
pnpm install

npx wrangler login
export CLOUDFLARE_ACCOUNT_ID=<your-account-id>

# 1. Generate the relay signing key, host-session key and admin placeholder, plus the APNs values.
#    Writes .secrets.json (gitignored, mode 600).
node scripts/generate-relay-secrets.mjs \
  --apns-p8 ~/Downloads/AuthKey_<KEYID>.p8 \
  --apns-key-id <KEYID> \
  --apns-team-id <TEAMID>
#    Add --fcm-json ~/Downloads/<firebase-service-account>.json for Android push.

# 2. First deploy: creates the Worker, its three Durable Object classes, both custom domains,
#    and uploads every secret in the same version.
npx wrangler deploy --secrets-file .secrets.json

# 3. Smoke checks
curl -s https://relay.seal.wotarmelon.com/health   # {"ok":true,...}
curl -s -o /dev/null -w '%{http_code}\n' https://push.seal.wotarmelon.com/v1/devices   # 401 without a host session
```

Later deploys need only `npx wrangler deploy`, because secrets persist across deploys.

## Secrets

| Secret                                            | Purpose                                                                                                |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `RELAY_JWT_PRIVATE_JWK`                           | ES256 private JWK that signs relay tokens for proven host keys                                         |
| `RELAY_JWKS`                                      | Public JWK set for that key; the relay Durable Objects verify control tokens with it                   |
| `HOST_SESSION_SECRET`                             | HMAC key for host session tokens (24 h)                                                                |
| `ADMIN_SIGNING_KEY`                               | Required by the shared relay-edge config. Unused, because the Seal router never exposes `/__admin`     |
| `APNS_TEAM_ID`, `APNS_KEY_ID`, `APNS_PRIVATE_KEY` | Token-based APNs auth (`.p8`). Topic is `APNS_TOPIC` = `com.brokespace.seal.mobile` in `wrangler.toml` |
| `FCM_SERVICE_ACCOUNT_JSON`                        | Optional Android push through FCM HTTP v1                                                              |

To add or replace APNs/FCM values later without rotating the relay keys:

```bash
printf '%s' "<TEAMID>" | npx wrangler secret put APNS_TEAM_ID
printf '%s' "<KEYID>"  | npx wrangler secret put APNS_KEY_ID
npx wrangler secret put APNS_PRIVATE_KEY < ~/Downloads/AuthKey_<KEYID>.p8
npx wrangler secret put FCM_SERVICE_ACCOUNT_JSON < ~/Downloads/<firebase-service-account>.json
```

To rotate everything, run `node scripts/generate-relay-secrets.mjs --force ...` and then `npx wrangler secret bulk .secrets.json`. Desktops re-authenticate on their own. Phones paired through the relay keep their credentials, because those live in the host's Durable Object, not in these keys.

## Local development

```bash
node -e "const s=require('./.secrets.json');console.log(Object.entries(s).map(([k,v])=>k+'='+JSON.stringify(v)).join('\n'))" > .dev.vars
pnpm dev   # --local-upstream keeps the request origin equal to what desktops dial
SEAL_RELAY_URL=http://127.0.0.1:8787 SEAL_PUSH_URL=http://127.0.0.1:8787 pnpm dev   # from the repo root
```

Local workerd speaks only HTTP/1.1 to upstreams, so APNs (HTTP/2 only) is unreachable from `wrangler dev`. Deployed Workers reach APNs over HTTP/2. The tests use a fake APNs server (`pnpm test`).

## MCP endpoint

`relay.seal.wotarmelon.com/mcp/<hostId>` is Seal's MCP endpoint for cloud clients; see `docs/mcp.md`. A server that turned relay access on dials `wss://relay.seal.wotarmelon.com/v1/host/mcp` with its host session, and the `SealMcpTunnel` Durable Object passes each public request down that socket.

- The first deploy that includes it applies migration `v2` (`new_sqlite_classes = ["SealMcpTunnel"]`) and the `MCP_LIMITER` rate-limit binding. Nothing else changes, and no new secret is needed.
- Unlike pairing traffic, MCP requests on this path are **not** end-to-end encrypted: the Worker terminates TLS and can read them. It stores and logs none of them. Do not turn on Workers Logs or Logpush for this Worker without reading the threat model in `docs/mcp.md`.
- Smoke check once deployed: `curl -s -o /dev/null -w '%{http_code}\n' -X POST https://relay.seal.wotarmelon.com/mcp/0000000000000000` answers `401` (no token).

## Notes

- Only end-to-end-encrypted frames cross the relay for pairing, terminals and device traffic. The MCP endpoint above is the exception. The desktop and the phone run their own X25519 E2EE channel; the Worker splices bytes and stores credential hashes.
- Nothing in this Worker calls Orca's cloud. Each host is its own relay account (`seal:<relayHostId>`), proven by its pairing key.
- If you change `wrangler.toml` routes, keep `relay.` and `push.` on the same Worker, or deploy the Worker twice with the same secrets.

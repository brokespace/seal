# Seal relay: deploy checklist

What to set on Cloudflare before and after deploying `cloud/seal-relay`, the Worker behind
`relay.seal.wotarmelon.com` and `push.seal.wotarmelon.com`. The build and upload steps are in
[`cloud/seal-relay/deploy.md`](../../cloud/seal-relay/deploy.md); this page is the security
configuration around them. It follows the fixes for the three audits in this folder.

Nothing here is applied by the repository. Every step is something you do in the Cloudflare
dashboard or with `wrangler`.

> Never paste a secret into a file that git tracks, a shell history you share, or a chat. The
> commands below read secrets from a file or from standard input, and `.secrets.json` and
> `.dev.vars` are gitignored.

## 1. Order of operations

1. Update the desktops and servers that will keep using the relay (section 9), and note each one's
   host id (section 2).
2. Put the secrets in place, including `HOST_ALLOWLIST` (sections 2 and 3).
3. Create the zone rules (section 5) and the billing alerts (section 6).
4. `npx wrangler deploy` from `cloud/seal-relay`, and confirm the bindings (section 4).
5. Run the smoke checks (section 7).

The Worker fails closed, so a step done late cannot open it up: until `HOST_ALLOWLIST` is set no
host can use the relay, and with a weak or missing `HOST_SESSION_SECRET` every request is answered
`503 {"error":"relay_misconfigured"}`.

## 2. The host allowlist

Only hosts on the allowlist can ask for a challenge, hold a session, mint a relay token, register a
push device, send a push, open a relay control socket or serve MCP. A phone can only reach a host
that is on it. Everyone else gets `403` (hosts) or the same answer an offline host gives (phones),
before any Durable Object is woken.

A host is named by its **host id**: 16 base64url characters derived from its pairing public key.
Print it on each machine:

```bash
seal relay host-id            # Seal must have run once on this machine; it need not be running now
```

The id is also the last path segment of the server's relay MCP URL (`seal mcp status`), and the
phone shows it, grouped in fours, on the pairing confirmation screen.

`HOST_ALLOWLIST` is the list of those ids, separated by commas or whitespace. An entry may also be
the host's full base64 public key. Set it as a secret so the list of your machines is not in the
repository:

```bash
cd cloud/seal-relay
printf '%s' '<host-id-1>,<host-id-2>' | npx wrangler secret put HOST_ALLOWLIST
```

Rules the Worker applies:

- **Unset or empty**: nobody is enrolled. Every host request is refused.
- **One malformed entry**: the whole Worker answers `503`. A typo never silently drops a host, and
  never reads as some other host.
- **Removing an id** takes effect on the next request in each isolate after the secret changes:
  the host's session and relay token stop working (`403`), its MCP tunnel is closed, and phones
  can no longer resolve it. `wrangler secret put` deploys a new version, so this is immediate.

To add a machine later, repeat the command with the full list. A host id changes only when the
machine's pairing key does (a new profile, or a wiped user-data directory), and that also unpairs
its phones.

## 3. Secrets

| Secret                                            | Needed   | Notes                                                                                                                                                                                             |
| ------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RELAY_JWT_PRIVATE_JWK`                           | yes      | ES256 private JWK that signs relay tokens (5 minutes).                                                                                                                                            |
| `RELAY_JWKS`                                      | yes      | Public JWK set for that key.                                                                                                                                                                      |
| `HOST_SESSION_SECRET`                             | yes      | HMAC key for host sessions (1 hour). Must be at least 32 characters with at least 12 distinct ones, or the Worker serves nothing. `generate-relay-secrets.mjs` writes 32 random bytes, base64url. |
| `HOST_ALLOWLIST`                                  | yes      | Section 2.                                                                                                                                                                                        |
| `ADMIN_SIGNING_KEY`                               | yes      | Required by the shared edge config. The Seal router exposes no admin route, so it is never used; keep it random anyway.                                                                           |
| `APNS_TEAM_ID`, `APNS_KEY_ID`, `APNS_PRIVATE_KEY` | iOS push | Token-based APNs auth from the `.p8` file.                                                                                                                                                        |
| `FCM_SERVICE_ACCOUNT_JSON`                        | optional | Android push.                                                                                                                                                                                     |

First deploy: `node scripts/generate-relay-secrets.mjs ...` writes `.secrets.json` (mode 600), then
`npx wrangler deploy --secrets-file .secrets.json`, then set `HOST_ALLOWLIST` as above.

Existing deploy: keep the secrets you have. Check the one that now has a strength rule, without
printing it:

```bash
node -e "const s=require('./.secrets.json').HOST_SESSION_SECRET||'';console.log(s.length>=32&&new Set(s).size>=12?'ok':'too weak: rotate it')"
```

If you no longer have `.secrets.json`, rotate: `node scripts/generate-relay-secrets.mjs --force ...`
then `npx wrangler secret bulk .secrets.json`. Hosts sign in again on their own and phones stay
paired.

There is no test-only override left in the production Worker. `PUSH_PROVIDER_ORIGIN_OVERRIDE` is
gone; if it is set as a variable or secret from an older deploy, delete it
(`npx wrangler secret delete PUSH_PROVIDER_ORIGIN_OVERRIDE`). It is now ignored either way.

## 4. Bindings that must exist

`wrangler.toml` declares them and `wrangler deploy` creates them. After the deploy, confirm under
Workers & Pages → `seal-relay` → Settings → Bindings that all four rate limiters are listed. A
request whose limiter is missing is **refused**, not let through.

| Binding             | Limit, per colo            | Keyed on                      |
| ------------------- | -------------------------- | ----------------------------- |
| `PREAUTH_LIMITER`   | 120 a minute               | source address                |
| `HOST_AUTH_LIMITER` | 30 a minute                | source address                |
| `HOST_API_LIMITER`  | 600 a minute               | host id (new in this release) |
| `MCP_LIMITER`       | 300 a minute               | host id and source address    |
| Durable Objects     | migrations `v1`, then `v2` | `v2` adds `SealMcpTunnel`     |

A source address is the IPv4 address, or the IPv6 `/64` the address belongs to, so rotating through
one network's addresses does not multiply the budget.

These limiters count per Cloudflare location. They bound what one source can do to the Worker; they
do not stop a request from being billed. The zone rules in the next section do.

## 5. Zone rules on `wotarmelon.com`

Zone rules run before the Worker, so a blocked request costs no Worker invocation and wakes no
Durable Object. Set them under the `wotarmelon.com` zone → Security → WAF.

### Custom rules (all plans, 5 on Free)

1. **Only the routes the Worker serves.** Action: Block.

   ```
   (http.host in {"relay.seal.wotarmelon.com" "push.seal.wotarmelon.com"})
   and not (
     http.request.uri.path eq "/health"
     or starts_with(http.request.uri.path, "/v1/")
     or starts_with(http.request.uri.path, "/mcp/")
   )
   ```

2. **Only the methods it serves.** Action: Block.

   ```
   (http.host in {"relay.seal.wotarmelon.com" "push.seal.wotarmelon.com"})
   and not (http.request.method in {"GET" "POST" "DELETE"})
   ```

Declared and streamed body sizes need no zone rule: the Worker stops reading a body at 16 KiB
(512 KiB on `/mcp/`) and answers `413`.

### Rate limiting rules

What the plan allows decides the shape. Use the first one that fits.

**Pro or higher (2+ rules, hostname in the expression, 1-minute window):**

| Rule                   | Expression                                                                                                                                                                                                                                                                     | Count by | Limit         | Then             |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- | ------------- | ---------------- |
| Seal sign-in endpoints | `(http.host in {"relay.seal.wotarmelon.com" "push.seal.wotarmelon.com"}) and (http.request.uri.path in {"/v1/host/challenge" "/v1/host/session" "/v1/resolve"} or starts_with(http.request.uri.path, "/v1/connect/") or starts_with(http.request.uri.path, "/v1/host/data/"))` | IP       | 60 per 1 min  | Block for 10 min |
| Seal everything        | `(http.host in {"relay.seal.wotarmelon.com" "push.seal.wotarmelon.com"})`                                                                                                                                                                                                      | IP       | 600 per 1 min | Block for 1 min  |

**Free (1 rule, path only, 10-second window, 10-second block):**

| Rule | Expression                                                                                  | Count by | Limit        | Then           |
| ---- | ------------------------------------------------------------------------------------------- | -------- | ------------ | -------------- |
| Seal | `starts_with(http.request.uri.path, "/v1/") or starts_with(http.request.uri.path, "/mcp/")` | IP       | 100 per 10 s | Block for 10 s |

A Free rule cannot name a hostname, so it applies to every site on the zone that serves `/v1/` or
`/mcp/` paths. If another site on `wotarmelon.com` does, move the relay to its own zone or use Pro.

How these numbers were chosen: a host signs in once an hour, renews its relay token every five
minutes and sends one request per push notification; a phone makes one `/v1/resolve` and one
WebSocket upgrade per reconnect. An MCP client is the busiest caller and the Worker already holds
it to 300 a minute per host. If you drive MCP hard from one address, raise "Seal everything" rather
than removing it.

After a day of normal use, open Security → Events and check that neither rule has blocked your own
machines.

### Also worth turning on

- If **Bot Fight Mode** is on for the zone, check Security → Events that it is not challenging
  your phones, servers or MCP clients: none of them can solve a challenge page. Bot Fight Mode
  cannot be skipped per hostname; Super Bot Fight Mode (Pro and up) can, with a skip rule for
  these two hostnames.
- SSL/TLS → Edge Certificates → **Minimum TLS version 1.2** and **Always Use HTTPS**.

## 6. Billing alerts and limits

The audits' cost findings are bounded in code now, but an alert is what tells you a bound is being
leaned on.

1. **Budget alerts** (account-wide, email only). Manage Account → Billing → Billable Usage → Set
   Budget Alert. Create two: one a little above a normal month, one at the amount you would want
   to be woken for. They are computed daily, so expect up to a day's delay.
2. **Spend limits** for Workers and for Durable Objects. Manage Account → Billing → Spend limits.
   Set an alert threshold on each. Turn on **Block usage** only if you prefer the relay going down
   to a larger bill: when it triggers, phones cannot reach hosts and push stops until the next
   billing period or until you raise the limit.
3. On the **Workers Free** plan there is no usage bill. The daily request and Durable Object
   allowances are the cap, and when one runs out the relay stops answering until the next UTC day.
   The zone rules above are then what keeps a stranger from spending your day's allowance.
4. Watch Workers & Pages → `seal-relay` → Metrics (requests, errors, CPU) and the Durable Objects
   namespace pages (requests, **Total storage**) after the deploy. Storage for `SealPushHost` and
   `SealHostRelay` should now stay flat at a few rows per enrolled host.

Leave **Workers Logs** and **Logpush** off for this Worker unless you have read the MCP threat
model in [`docs/mcp.md`](../mcp.md): the Worker terminates TLS for `/mcp/`.

## 7. Smoke checks after the deploy

None of these needs a credential.

```bash
curl -s https://relay.seal.wotarmelon.com/health                     # {"ok":true,...}

# A key that is not on the allowlist gets nothing: 403
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://push.seal.wotarmelon.com/v1/host/challenge \
  -H 'content-type: application/json' \
  -d "{\"hostPublicKeyB64\":\"$(head -c 32 /dev/urandom | base64)\"}"

# No session: 401
curl -s -o /dev/null -w '%{http_code}\n' https://push.seal.wotarmelon.com/v1/devices

# A host id that is not enrolled does not exist as far as MCP is concerned: 404
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://relay.seal.wotarmelon.com/mcp/0000000000000000

# Placement is not an oracle: 401 whether or not the host exists
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://relay.seal.wotarmelon.com/v1/resolve \
  -H 'content-type: application/json' -d '{"v":1,"relayHostId":"0000000000000000","resumeToken":"x"}'
```

Then, on an enrolled machine, pair a phone through the relay and send yourself a notification.

## 8. State left by an older deploy

Before these fixes, anyone could make the Worker create a small Durable Object per made-up host id.
Those objects are now unreachable: a request for a host that is not enrolled never gets as far as a
Durable Object, so they cannot grow, and they hold no credential. Each is a few kilobytes.

- **Leave them** if the namespace's Total storage is small. This is the default and needs nothing.
- **Wipe them** if it is not. There is no way to list or delete objects one by one from outside, so
  the only tool is a `deleted_classes` migration followed by a second deploy that creates the
  classes again. That also deletes every enrolled host's relay credentials and push
  registrations: each phone must pair again, and each desktop registers for push again on its own.
  Do this only if the storage is costing you something.

Objects that belong to enrolled hosts clean themselves from now on: expired challenges, old quota
rows, finished credential installs and revoked devices are purged on a timer, and an object with
nothing left deletes its own storage.

## 9. What changes for clients

See [`relay-security-migration.md`](./relay-security-migration.md) for the version requirements and
the re-pairing steps on desktops, servers and phones.

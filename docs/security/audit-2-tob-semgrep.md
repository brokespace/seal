# Seal relay & push — security audit 2 (Trail of Bits + Semgrep methodology)

- **Target commit:** `95dd0be278f` on branch `seal/mobile` (`brokespace/seal`).
- **Scope:** the Cloudflare Worker in `cloud/seal-relay/` (relay + push gateway) and the
  shared edge it wraps (`cloud/apps/relay-edge/`, `cloud/apps/push/`,
  `cloud/packages/{relay,push}-contract/`), plus every desktop / server / mobile code path that
  talks to it: pairing, device keys, credential minting, the relay protocol
  (`src/shared/remote-runtime/relay/*`, `mobile-relay-phone-protocol`), the E2EE stack
  (`src/shared/remote-runtime/e2ee/*`, `src/main/runtime/rpc/mobile/e2ee/*`), the push gateway
  client (`src/main/runtime/push/*`) and the headless Seal server (orcad) endpoints reachable
  through it (`src/main/runtime/rpc/*`).
- **Deployment model:** one Worker on Brian's Cloudflare account serving
  `relay.seal.wotarmelon.com` and `push.seal.wotarmelon.com`, forwarding to the home server
  `kessel-ml`, which can run shell commands. **Core question:** can anyone who is _not_ a paired
  device of Brian's reach, read, forge, replay or hijack anything, or get code execution on his
  machines?
- **Report only.** No product code was changed. The only additions are this report and
  proof-of-concept tests under `cloud/seal-relay/test/security/`, which are **skipped by default**
  and run with `SEAL_SECURITY_POC=1 pnpm test test/security`. They assert that an attack works
  _today_, so a later fix makes them fail by design.

## Verdict

**The design meets its hardest goal.** On the transport the relay actually forces — E2EE v2 — the
relay operator and any unpaired internet user **cannot** read plaintext, forge or replay frames,
impersonate Brian's host, bypass device authentication, or reach an orcad RPC (let alone a
shell). v2 has per-session server randomness, HKDF key separation, a bound transcript, strict
monotonic counters, direction/kind nonce separation, key confirmation, and a client-pinned host
key. Impersonating Brian's host needs his X25519 secret even if the relay's JWT signing key leaks.
These are verified negatives (§ Verified negatives), several with existing tests.

The residual risk is **not** confidentiality of E2EE traffic or remote code execution _by the
relay_. It is:

1. **Open enrolment (SR-01, High).** There is no host allowlist. Any internet user can drive the
   full host lifecycle and the push API on Brian's Cloudflare account and his Apple/Google push
   keys. This is abuse / cost / DoS and notification-spoofing capacity, not a read of Brian's data.
2. **A still-accepted legacy E2EE framing on the direct transport (E2EE-01, High).** It has no
   server randomness and no replay/reorder protection, and the client can be downgraded to it on a
   first-ever direct connection. This is the one path by which a man-on-the-LAN could _replay a
   captured shell command_ — but only on the direct (LAN/Tailscale) transport, never through the
   relay, which refuses legacy.
3. **Operator-secret and token-lifetime weaknesses (SR-06/SR-05, Medium).** `HOST_SESSION_SECRET`
   is the sole gate on the push API for a fingerprint and is never validated; relay JWTs live 12×
   longer than the contract says and nothing is revocable; the pairing `deviceToken` never expires.

Fix the host-enrolment gate and retire (or hard-gate) the legacy framing and the relay goes from
"safe against the relay operator, abusable by strangers" to "safe, period".

## Method & tools

Followed the Trail of Bits `audit-context-building`, `static-analysis` (Semgrep),
`variant-analysis`, `insecure-defaults`, `sharp-edges`, `constant-time-analysis` and
`crypto-protocol-diagram` skills and the Semgrep `code-security` skill. Every finding was verified
independently; most ship a runnable PoC.

| Tool                 | Version                                    | Notes                                                                                                                                                                                                                                                                                                                                                                            |
| -------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Semgrep OSS          | 1.185.0                                    | `p/security-audit`, `p/owasp-top-ten`, `p/cwe-top-25`, `p/jwt`, `p/command-injection`, `p/insecure-transport`, `p/secrets`, `p/javascript`, `p/typescript`, `p/nodejs`, `p/react`, `p/github-actions`, ToB rules, elttam rules, apiiro malicious-code ruleset. **OSS only** — no Pro, so cross-file taint was not run; custom taint-style rules below cover the reachable sinks. |
| Semgrep custom rules | —                                          | 8 variant rules (`decodeURIComponent` on request paths, limiter fail-open, unbounded body read, non-constant-time secret compare, static-DH session key, `Math.random` in security code, env-keyed HMAC, test-only origin override).                                                                                                                                             |
| CodeQL               | 2.27.4, `javascript-security-extended.qls` | Full DB over the scope snapshot (4638 files). "CodeQL-style" taint as the task requested.                                                                                                                                                                                                                                                                                        |
| Miniflare / wrangler | from `cloud/seal-relay`                    | PoC relay spun up in-process via the existing `seal-relay-harness.ts`.                                                                                                                                                                                                                                                                                                           |

SAST was low-signal against this codebase (it is already carefully written); the findings below
come from manual protocol review with SAST used for variant analysis and corroboration. The prior
dependency/image review (`cloud/docs/relay-security-2026-10-21.md`) is complementary and not
repeated here.

## Protocol overview

```
Desktop/orcad (static X25519 "host key", orca-e2ee-keypair.json)
  POST /v1/host/challenge  -> sealed nacl.box challenge to host pubkey (10s)   [unauth, rate-limited 30/min/IP]
  POST /v1/host/session    -> HMAC proof -> stateless session token fp.exp.sig (24h, HOST_SESSION_SECRET)
  POST /v1/host/relay-token-> ES256 JWT sub=seal:<hostId> purpose=host-control (60m)
  POST /v1/assign          -> cellUrl + assignmentEpoch
  WS   /v1/host/control    -> JWT + host-hello (key binding) + sealed challenge/HMAC proof + generation
Phone (deviceToken = 24 random bytes, from the pairing QR/code)
  POST /v1/resolve         -> placement (unauth, rate-limited)               [resumeToken in body is ignored]
  WS   /v1/connect/<hostId>-> cleartext relay-auth {credential=invite|resume} -> splice to host
  then  E2EE v2 over the spliced byte stream: ephemeral X25519 + host static key,
        HKDF-SHA256 -> m2d/d2m keys + sessionId, nacl.secretbox frames with a deterministic
        counter nonce, e2ee_auth carries the deviceToken (or an Ed25519 device-key proof),
        e2ee_authenticated echoes the transcript hash (key confirmation).
```

The relay sees: host pubkey / relayHostId / relayDeviceId, source IPs, frame sizes and timing, and
the phone's _relay_ credential (invite/resume) in the clear. It does **not** see E2EE plaintext.
Push titles/bodies and device push tokens are **not** end-to-end encrypted — they reach the Worker,
Apple and Google in the clear.

---

## Findings

Severity reflects impact against the core question (unpaired reach / read / forge / replay /
hijack / RCE) and the single-user home deployment.

### SR-01 — Open host & push enrolment (no allowlist) — High

- **Where:** `cloud/seal-relay/src/index.ts` (`handleChallenge`/`handleSession`/`handleRelayToken`/
  `handleAssign`, lines 76–151, and `handlePush`, 175–205); `cloud/seal-relay/src/host-auth.ts`
  (`issueHostChallenge`, 34–80). `deploy.md`: "Each host is its own relay account
  (`seal:<relayHostId>`), proven by its pairing key."
- **What:** every host-facing endpoint authenticates only a _self-generated_ X25519 key. There is
  no list of keys Brian owns. Any internet user generates a keypair, passes the sealed-challenge
  handshake for their own key, and gets a host session, a relay JWT, a cell assignment, a live
  control socket, and the full push API (register/list/delete devices, send notifications) — all
  running on Brian's Worker, Durable Objects, and his APNs `.p8` / FCM service-account keys and the
  `com.brokespace.seal.mobile` topic.
- **Impact:** not a read of Brian's data (push and relay state are scoped per host fingerprint, and
  the attacker's own key gives its own scope). It is (a) unauthorized use of Brian's paid
  Cloudflare/Apple/Google resources, (b) DoS and cost amplification, and (c) the capacity to send
  APNs/FCM traffic signed by Brian's push identity. Combined with SR-06 it becomes a push-hijack of
  _Brian's_ devices.
- **Exploitability:** trivial, remote, unauthenticated.
- **PoC:** `open-host-enrolment.test.ts` — a stranger key completes the full
  challenge→session→token→assign→control→invite→phone-connect roundtrip and separately delivers an
  attacker-authored notification through the APNs path with Brian's topic.
- **Fix:** gate enrolment to host keys Brian owns — an allowlist of host fingerprints (or an
  operator-signed enrolment token) checked in `handleChallenge`/`handleRelayToken`/`handlePush`
  before any durable write or provider call. A single-user deployment can pin exactly the
  fingerprints of `kessel-ml` and Brian's other machines.

### E2EE-01 — Legacy E2EE framing is replayable and downgradable (direct transport) — High

- **Where:** `src/main/runtime/rpc/mobile/e2ee/e2ee-channel.ts` `handleHello` (216–239): when
  `requireV2` is false, the key is `deriveSharedKey(hostSecret, clientPub)` with **no server
  randomness**; legacy frames are `nacl.box.after` with **random nonces and no counter**
  (`src/shared/remote-runtime/e2ee/node/e2ee-crypto.ts` 46–73). `requireV2` is true only for the
  relay transport (`src/main/runtime/rpc/mobile/mobile-socket-wiring.ts:197`); the direct transport
  still accepts legacy. Client downgrade policy:
  `src/shared/remote-runtime/e2ee/paired-e2ee-framing-policy.ts:25-30` allows legacy for any host
  not yet "latched" as v2-seen.
- **What:** because the shared key is a pure function of the host static key and the client public
  key — both replayed verbatim from a capture — an attacker who records a legacy session can
  replay the _entire authenticated session_ (including the `e2ee_auth` bearer and any
  `terminal.send`) onto a brand-new socket, with no key, no token and no live phone. Within a live
  session, frames can be reordered and duplicated freely (no counter). An on-path attacker present
  at a host's _first-ever_ direct connection (before it latches v2) can also force the legacy path.
- **Impact:** command _replay_ — re-executing a shell command the phone legitimately ran — is the
  closest an unpaired party gets to code execution. It is bounded: it needs the **direct** (LAN /
  Tailscale) transport (the relay forces v2 and only ever sees ciphertext, so the relay operator
  cannot do this), an on-path position, and a host not yet v2-latched.
- **Exploitability:** medium; requires LAN/on-path position and legacy framing.
- **PoC:** `legacy-e2ee-replay.test.ts` — replays a captured `terminal.send` verbatim on a fresh
  `E2EEChannel`, and reorders+duplicates frames inside one session.
- **Fix:** retire legacy framing, or default the v2 latch to "latched" for new hosts so the only
  legacy use is an explicit, operator-confirmed downgrade; at minimum require v2 on all transports
  for orcad (`kessel-ml` is new enough to never need legacy). Add a per-session nonce/counter to any
  framing that must remain.

### SR-06 — `HOST_SESSION_SECRET` is unvalidated and is the sole gate on the push API — Medium (High if misconfigured)

- **Where:** `cloud/seal-relay/src/host-auth.ts` `mintHostSession`/`verifyHostSession` (92–125) —
  `createHmac('sha256', secret)` with no check that `secret` is present or strong;
  `cloud/seal-relay/src/env.ts:11` types it as a required string but nothing enforces it;
  `cloud/seal-relay/src/index.ts:224-235` makes this token the only credential for `/v1/send`,
  `/v1/devices*` and `/v1/host/relay-token`.
- **What:** if the operator deploys with an empty or weak `HOST_SESSION_SECRET`, session tokens are
  forgeable for _any_ fingerprint. An attacker then reads a victim host's device list, swaps a
  device's push token to their own (same `deviceId` keeps the `registrationId` the victim's desktop
  sends to), and spoofs notifications to the victim's phone (e.g. a phishing
  "Deploy to production? (y/n)"). The forged session also mints a relay JWT for the victim host id —
  but the control seat still requires the victim's X25519 secret (host-proof), so this does **not**
  yield impersonation or RCE.
- **Note:** the shipped generator (`scripts/generate-relay-secrets.mjs`) produces a 32-byte random
  secret, so a correct deployment is safe. This is an insecure-default / defense-in-depth gap, not a
  live break of the intended config.
- **PoC:** `weak-host-session-secret.test.ts` (offline recovery of a guessable secret, then
  list→hijack→spoof against a victim, and confirms the control seat stays blocked) and
  `empty-host-session-secret.test.ts` (the Worker boots and accepts forged sessions with `""`).
- **Fix:** validate at startup that `HOST_SESSION_SECRET` is present and ≥ 32 bytes (the shared edge
  already does this for `ADMIN_SIGNING_KEY` in `cloud/apps/relay-edge/src/env.ts`); fail closed
  otherwise.

### SR-05 — Over-long, non-revocable tokens and never-expiring pairing credentials — Medium

- **Where:** relay JWT TTL `cloud/seal-relay/src/relay-token.ts:5` = **60 min** while the contract
  `relayTokenTtlMs` (`cloud/packages/relay-contract/src/protocol-limits.ts:16`) is **5 min**; host
  session 24 h (`push-limits.ts:13`), both stateless with no revocation; pairing `deviceToken` is 24
  random bytes with **no expiry after first use** (`device-credential.ts:8`); headless pairing
  offers **never expire** (`pairing-offer-expiry.ts:11,28` — `seal serve` passes no `offerTtlMs`);
  resume tokens 30 days (`protocol-limits.ts:15`).
- **What:** a leaked relay JWT is usable 12× longer than intended; a leaked session or device token
  cannot be revoked server-side (only by rotating `HOST_SESSION_SECRET`, which unpairs everyone, or
  by host-side device removal); a leaked headless pairing code is a permanent credential.
- **Impact:** widens the window for every token-theft scenario (including E2EE-02).
- **PoC:** none (configuration/contract review); corroborated by reading the constants above.
- **Fix:** align the Worker JWT TTL with the 5-min contract; add expiry to `deviceToken` and to
  headless offers; provide a revocation list (or short-lived sessions) for host sessions.

### E2EE-02 — No forward secrecy: the static host key decrypts recorded sessions — Medium

- **Where:** both schemes derive the session secret from an X25519 agreement with the _static_ host
  key (`e2ee-channel.ts:232`, `mobile-e2ee-v2-desktop-session.ts:63`); the host key is long-lived in
  `orca-e2ee-keypair.json` and is deliberately never rotated
  (`src/main/runtime/rpc/server/pairing/e2ee-keypair.ts:58-67`).
- **What:** a later disclosure of that one file lets a passive observer who logged ciphertext
  decrypt every recorded session — including the `deviceToken` the phone sends in `e2ee_auth`, which
  on the direct transport is itself a usable bearer.
- **Impact:** retroactive decryption + bearer recovery after host-key compromise. The relay cannot
  do this on its own (it never has the host secret), so it is a key-compromise amplifier, not a
  relay-operator capability.
- **PoC:** `no-forward-secrecy.test.ts` — host secret + a passive legacy capture recovers the
  bearer.
- **Fix:** add an ephemeral host key to the v2 handshake (double-ratchet-lite / X3DH-style) so the
  static key only authenticates and session keys get forward secrecy; at minimum stop carrying a
  long-lived bearer inside the transcript (prefer the Ed25519 device-key proof, which is already
  supported, over the `deviceToken` for mobile).

### SR-02 — Unauthenticated durable writes; IPv6 /64 defeats the per-IP limit — Medium

- **Where:** `cloud/seal-relay/src/index.ts` `handleChallenge` (76–92) creates a `SealPushHost`
  Durable Object and writes a `challenges` row for _any_ submitted pubkey; `admitHostAuth`
  (`index.ts:64-70`) keys the limiter on `cf-connecting-ip` only and **returns `true` when the
  limiter binding is absent** (fail-open); the shared edge's `admitPreAuth`
  (`cloud/apps/relay-edge/src/preauth.ts:28`) also fails open.
- **What:** 30 unauthenticated DO-creating writes per minute per IP, and the limit is per _address_,
  not per prefix — an attacker with a routed IPv6 /64 (standard allocation) rotates addresses for
  effectively unlimited challenge/DO creation and unauthenticated `/v1/connect/<hostId>` load
  against a victim host's objects.
- **Impact:** resource exhaustion / cost on Brian's account; storage growth; no confidentiality
  impact.
- **PoC:** `host-auth-rate-limit-bypass.test.ts` — one address is capped at 30/min, but 120
  addresses inside one /64 all succeed.
- **Fix:** rate-limit on the IPv6 /64 (the edge already computes a `/64` source key in
  `preauth.ts:sourceKey`; apply it in `admitHostAuth`), require enrolment (SR-01) before any durable
  write, and treat a missing limiter binding as fail-closed in production.

### SR-07 — `decodeURIComponent` on request-path segments throws → 500 / hung request — Low

- **Where:** `cloud/seal-relay/src/index.ts:195` (`DELETE /v1/devices/<id>`, authenticated);
  `cloud/apps/relay-edge/src/index.ts:110` and `:192` (`/__spike/abort-splice/*` and
  `/v1/host/data/*`, the latter **pre-auth**). A malformed percent-escape makes
  `decodeURIComponent` throw a `URIError`, which is uncaught.
- **Impact:** a correct handler should answer 400/404; instead the Worker 500s (and in one path the
  upgrade request hangs). Minor pre-auth DoS / robustness issue, flagged by the custom
  `seal-uncaught-decode-uri-component` rule and CodeQL.
- **PoC:** `malformed-path-escape.test.ts`.
- **Fix:** wrap `decodeURIComponent` in a try/catch (or validate the segment against the expected
  charset first) and return a clean rejection.

### SR-03 — Unauthenticated placement oracle; `resumeToken` ignored — Low

- **Where:** `cloud/seal-relay/src/index.ts` `handleResolve` (153–173) returns 200 vs 404 by host
  existence, with no credential; the `resumeToken` the phone sends in the body
  (`ResolveRequestSchema`, 32–36) is parsed but never used.
- **Impact:** an unauthenticated caller can confirm whether a given relayHostId is enrolled (minor
  information leak / enumeration oracle, bounded by the 96-bit host id). The ignored `resumeToken`
  is dead input, not a vuln, but it is attacker-controlled data that looks meaningful.
- **PoC:** `open-host-enrolment.test.ts` (the resolve-oracle case).
- **Fix:** fold `resolve` behind enrolment/credential context or at least return a uniform response;
  drop the unused `resumeToken` field from the schema.

### SR-08 — Low-order / degenerate X25519 points accepted — Low / Info

- **Where:** `cloud/seal-relay/src/host-auth.ts:39` (`decodeCanonicalBase64(..., 32)` with no
  small-order check); `e2ee-crypto.ts:publicKeyFromBase64` and the v2 handshake likewise accept any
  canonical 32-byte key.
- **Impact:** a client can submit a low-order point producing a predictable/degenerate shared
  secret, but authentication still requires a valid bearer/proof, so this is not independently
  exploitable here. Noted for defense-in-depth and contributory-key hygiene.
- **Fix:** reject the known small-order X25519 points on both the challenge and E2EE paths.

### SR-10 — Test-only provider-origin override lives in the production code path — Low / Info

- **Where:** `cloud/seal-relay/src/push-providers.ts:17-22` (`PUSH_PROVIDER_ORIGIN_OVERRIDE`
  redirects all APNs/FCM/Google traffic — including bearer tokens — to an arbitrary origin);
  `env.ts:19`.
- **Impact:** if this var were ever set in production (misconfig or env-injection), provider
  requests and their credentials would be exfiltrated. Flagged by the custom
  `seal-test-only-origin-override` rule.
- **Fix:** gate it behind an explicit test/dev flag, or strip it from the production build.

### SR-11 — Push content and device tokens are not end-to-end encrypted — Low (by design, documented)

- **Where:** titles/bodies (≤80/≤180 chars) and the APNs/FCM device token transit the Worker,
  Apple and Google in cleartext (`seal-push-host.ts:deliver` 150–168, `push-providers.ts`); the
  phone registers its token via `notifications.registerPush`.
- **Impact:** the relay operator (and Apple/Google) can read notification text and the device token.
  This is inherent to push and is the documented trade-off; listed so the operator knows not to put
  secrets in notification bodies. The PoC in `open-host-enrolment.test.ts` shows the alert body
  readable at the gateway.
- **Fix:** keep notification copy non-sensitive; optionally encrypt the body to the device and
  render on-device.

### Supply-chain / CI (from Semgrep `p/github-actions`, out of the core question) — Low

- `.github/workflows/seal-relay.yml:34,36` and ~400 other workflow steps pin actions by mutable tag,
  not SHA (`github-actions-mutable-action-tag`); several release workflows use `secrets: inherit`.
  `cloud/seal-relay/pnpm-workspace.yaml` does not set `minimumReleaseAge` / `trustPolicy` /
  `blockExoticSubdeps`. These are standard hardening items, not relay-specific breaks.

---

## Verified negatives (checked, believed safe)

- **Relay cannot read, forge or replay E2EE v2 content.** v2 derives keys from the client ephemeral
  - a per-session desktop nonce via HKDF with a transcript-bound `info`
    (`mobile-e2ee-v2-node-key-schedule.ts`), frames are `nacl.secretbox` with a deterministic
    `sessionId‖version‖dir‖kind‖counter` nonce and a strict expected counter re-checked against the
    in-plaintext header (`mobile-e2ee-v2-framing.ts`), and the relay transport forces v2. Cross-socket
    replay of a captured v2 trace is already rejected (existing test
    `e2ee-channel-v2.test.ts` "rejects a captured authenticated mutating trace on a fresh socket").
- **Host impersonation needs the host's X25519 secret, not just the JWT.** The control socket
  additionally requires a sealed-challenge HMAC proof over a transcript bound to the relay origin,
  host key, relayHostId, epoch and generation
  (`src/main/runtime/mobile-cloud-relay/control-channel/relay-host-proof.ts`,
  `cloud/apps/relay-edge/src/host-relay-handshake.ts`), and the host-hello binds
  `sha256(hostPublicKey)[:16] === claims.relayHostId`. A leaked relay JWT (or a forged one via a
  leaked signing key) still cannot take the seat. SR-06's PoC confirms this.
- **Key confirmation and downgrade protection exist for v2.** `e2ee_authenticated` echoes the
  transcript hash; the client pins the host public key and rejects a mismatched `e2ee_ready`
  (`paired-e2ee-v2-client-session.ts:69`), and a latched host refusing v2 is treated as an auth
  failure (`paired-e2ee-framing-policy.ts:30`).
- **No RPC before `e2ee_auth`; mobile RPC is allowlisted.** `terminal.create`/`terminal.send` and
  friends require a `mobile`-scope principal that passed E2EE auth, admitted only via
  `MOBILE_RPC_METHOD_ALLOWLIST` (`runtime-rpc-websocket-dispatch.ts:186`,
  `runtime-rpc-mobile-method-routing.ts`). `seal.accounts.exportCredential` is `accounts-admin` +
  `requireDesktopCaller`, so a phone cannot export credentials
  (`src/main/runtime/rpc/methods/accounts/seal-accounts.ts:228-233`).
- **Push is scoped per host fingerprint.** A stranger host cannot send to another host's devices
  (existing test "scopes devices to the host key that registered them"); confirmed again under the
  SR-06 flow, which only works once the session secret is forged.
- **The shared edge admin / spike routes are unreachable.** `RELAY_PATHS`
  (`cloud/seal-relay/src/index.ts:39`) only forwards `health`, `v1/host/control`,
  `v1/connect/*`, `v1/host/data/*`; `/__admin*` and `/__spike*` 404 (existing test "keeps the shared
  edge admin routes unreachable").
- **Internal `x-edge-*` headers are stripped** before forwarding
  (`cloud/apps/relay-edge/src/index.ts`), so a client cannot spoof edge-internal routing.
- **The relay-token mint is bound to the proven key** — `relayHostId === fingerprint &&
  fingerprintOfPublicKey(pub) === fingerprint` (`index.ts:123-129`), so a session for key A cannot
  mint a token for host B (existing test "mints relay tokens only for the key the host session
  proved").

## What the relay can see or tamper with

- **See:** host public key / relayHostId / relayDeviceId, source IPs, connection timing, frame
  sizes (length side-channel on compressed-then-encrypted frames), the phone's _relay_ credential
  (invite/resume) in cleartext, and all push content + device tokens.
- **Tamper:** it can drop/delay/reorder the opaque byte stream (a v2 peer detects this via counters
  and closes; a legacy peer does not — E2EE-01), and it chooses placement/assignment. It **cannot**
  read or forge E2EE plaintext, authenticate as a device, or take Brian's host control seat.

## Reproducing the PoCs

```
cd cloud/seal-relay
pnpm install
SEAL_SECURITY_POC=1 pnpm test test/security      # all 12 PoCs pass (attacks work today)
pnpm test                                         # default run: PoCs skipped, real suite green
```

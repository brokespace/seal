# Seal relay and push — security audit 1 (Cloudflare security-audit skill)

- **Target:** the Seal Cloudflare relay and push Worker in `cloud/seal-relay`, the shared edge code it
  imports (`cloud/apps/relay-edge`, parts of `cloud/apps/relay` and `cloud/apps/push`, the two contract
  packages), and every desktop, headless-server (`orcad` / `seal serve`) and mobile path that talks to
  it: pairing, device keys, credential minting, the relay protocol, the push gateway and the RPC
  surface a relay connection can reach.
- **Audited commit:** `95dd0be278f61ff69b107ef6e61dd72f257082ab` on `seal/mobile` (the same base as
  audits 2 and 3). `seal/mobile` has since moved to `291fb3ac`; nothing under `cloud/` changed, and of
  the 135 files this report cites only four changed, all of them wording (Orca → Seal) or docs. Line
  numbers below are for `95dd0be`.
- **Method:** [cloudflare/security-audit-skill](https://github.com/cloudflare/security-audit-skill) at
  `c1c8a8c`, `standard` profile, scoped run. Six phases: reconnaissance, hunting with a coverage
  ledger, independent validation of every candidate, record assembly, a second independent
  verification of every record, report.
- **Nothing was deployed and no deployed endpoint was contacted.** Every proof of concept ran
  against the real Worker in local workerd (wrangler's `unstable_startWorker`, the repository's own
  test harness) inside a sandbox with no network, with keys and tokens generated in the test.
- **This report changes no product code.** It adds this file and opt-in PoC tests under
  `cloud/seal-relay/test/security/audit-1/` (see [Proofs of concept](#proofs-of-concept)).

## Run status: incomplete

The skill requires every candidate to be validated by an independent agent and every surviving record
to be verified by a second one. Four candidates did not get that: the agents assigned to them were
refused by the model provider's cyber-content safeguard, and I did not retry them, reword the
requests or do that verification myself. They are listed under
[Unverified candidates](#unverified-candidates) with what was and was not established, and they are
**not** counted as findings. Re-running those four needs the account admin to request verification
through the provider dashboard.

Everything else completed: both coverage critics closed the ledger, and the two validators the skill
ships (`validate-findings.cjs`, `validate-coverage-ledger.cjs`) pass on the final files.

## Verdict

**The core question — can anyone who is not one of Brian's paired devices reach, read, forge, replay
or hijack anything, or get code execution on his machines through the relay — the answer this audit
found is no.** No finding, candidate or hardening note gives an unpaired party an RPC call, terminal
bytes, file access or a command on `kessel-ml`. The controls that hold are listed under
[Controls that held](#controls-that-held).

**Is it safe to deploy? Not as it stands, for cost and availability reasons, and with one operating
rule for the home server.**

1. **Fix A1-01 and A1-02 first** (both small). Today any anonymous client can create permanent
   Durable Object storage on Brian's account at about 4 MB a minute per address, with every address of
   an IPv6 /64 counted separately, and nothing ever deletes it. Add a zone rate-limiting rule and a
   billing alert in front of the two hostnames whatever else is done.
2. **Close the open enrolment that audits 2 and 3 rank highest** (SR-01 / F9). The relay is meant
   for one person's hosts; an allowlist of host fingerprints on `/v1/assign`, `/v1/devices` and
   `/v1/send` removes the attacker from A1-01's challenge path, A1-NV1, A1-NV2, A1-NV5 and A1-U1 in
   one change. Audit 3's F1 (request body buffered before the size check) and audit 2's SR-06
   (`HOST_SESSION_SECRET` not validated) should be fixed in the same pass; this audit saw both and
   under-rated them (see [Cross-reference](#cross-reference-with-audits-2-and-3)).
3. **On `kessel-ml`, revoking a phone by editing `orca-devices.json` is not a complete revoke**
   (A1-04, A1-05). Until a headless revoke command exists, remove the row **and restart the
   service**; that closes the open session and stops push alerts. The phone's relay credential still
   passes the relay's outer check for up to 30 days, but the host refuses it at the inner
   authentication.
4. The four unverified candidates include one that stops the headless host process (A1-U3). Its
   sender is the relay itself, so on Brian's own Cloudflare account it needs a compromise of that
   account or Worker first; it should still be fixed before the server depends on the relay.

## Findings

Eight confirmed findings, each reproduced locally by an independent validator and re-checked by a
second verifier. Severity is the skill's likelihood × impact rating.

| ID    | Severity   | Finding                                                                                                 | Who can do it                                                | PoC       |
| ----- | ---------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | --------- |
| A1-01 | **Medium** | Anonymous requests create permanent Durable Object storage for caller-chosen host ids                   | Anyone                                                       | Confirmed |
| A1-02 | Low        | Host-auth rate limiter counts every IPv6 address separately                                             | Anyone with a /64                                            | Confirmed |
| A1-03 | Low        | Pairing crash-recovery sends a paired host's relay resume token to an attacker-supplied cell            | Attacker who gets the user to confirm a crafted pairing code | Confirmed |
| A1-04 | Low        | Removing a device row from the registry file leaves its open session receiving terminal output          | Previously paired device                                     | Confirmed |
| A1-05 | Low        | Registry-file revoke leaves push delivery, the relay credential and the push registration live          | Previously paired device                                     | Confirmed |
| A1-06 | Low        | A relay device revoke that fails once is never retried while the relay session stays up                 | Previously paired device                                     | Confirmed |
| A1-07 | Low        | A late first relay frame makes the phone disable a valid relay credential                               | On-path network party, or a bad link                         | Confirmed |
| A1-08 | Low        | A far-future invite expiry from the relay traps the host in a 1 ms reconcile loop that survives restart | Relay operator or a compromised Worker                       | Confirmed |

### A1-01 — Anonymous requests create permanent Durable Object storage (Medium)

- **Where:** `cloud/seal-relay/src/index.ts:221,155,162` (`handleResolve`) →
  `cloud/seal-relay/src/seal-host-relay.ts:25` (`sealPlacement`) →
  `cloud/apps/relay-edge/src/host-relay-base.ts:115` (the `store` getter) →
  `cloud/apps/relay-edge/src/object-store.ts:79,198` (constructor runs `openSchema`). Also
  `handleChallenge` and `handleSession` (`index.ts:76-112`) through the `SealPushHost` constructor
  (`cloud/seal-relay/src/seal-push-host.ts`).
- **What:** three routes need no credential and each one instantiates a Durable Object named by an id
  the caller picks, then writes SQLite tables into it. `POST /v1/resolve` for any 16-character id
  creates the whole per-host credential schema and answers 404. `POST /v1/host/challenge` creates a
  push-host object with three tables and a challenge row for any 32 bytes offered as a key.
  `POST /v1/host/session` creates the same tables for any fingerprint written into an invented
  challenge id and answers 401. Nothing removes them: the sweep that wipes never-assigned relay
  objects runs only from an alarm that this path never arms, and `SealPushHost` has no alarm and no
  delete path. The shared edge states and keeps the opposite rule on its own anonymous path
  (`pushed()` is "Read-only: an object nobody pushed has no tables, and this must not create them").
- **Exploitability:** one small JSON POST per object, no key, no earlier state. The only brake is
  `HOST_AUTH_LIMITER` at 30 per 60 s per address (see A1-02).
- **Measured locally:** a resolve leaves 11 tables, 18 indexes and 135,168 bytes; a challenge or
  refused session leaves 3 tables and 32,768 bytes; an expired challenge row was still present 42 s
  later, and the storage survived a restart. Controls: a phone connect to an unknown id creates no
  tables, and a registered host keeps working. Provider-side byte accounting and what happens at the
  account's storage allowance were not observed.
- **Impact:** unbounded, permanent growth of operator-paid storage. No host data is read or changed.
- **Fix:** in `sealPlacement`, return null when the read-only `pushed()` check fails, before touching
  `this.store`. In `SealPushHost`, create tables lazily (only in `storeChallenge` and
  `registerDevice`), set an alarm when a challenge is stored, and in the alarm purge expired
  challenges and `deleteAll()` when no device or quota row remains. Objects already created by
  anonymous requests carry no alarm and need a one-off cleanup. The validator applied these changes
  to a scratch copy and the effect disappeared with the round-trip test still passing.
- **Other audits:** audit 2 SR-02 (challenge path), audit 3 F2 (resolve and challenge, rated High).
  New here: the `/v1/host/session` path, the measurement that the objects are permanent (no alarm is
  armed, so the existing sweep cannot reach them), and the controls.

### A1-02 — Host-auth limiter keyed on the full IPv6 address (Low)

- **Where:** `cloud/seal-relay/src/index.ts:68` (key), `:77`, `:212`.
- **What:** `admitHostAuth` uses the whole `cf-connecting-ip` value as the limiter key. The pre-auth
  limiter in the same Worker reduces IPv6 callers to their /64 (`cloud/apps/relay-edge/src/preauth.ts:12`)
  because one subscriber holds a whole /64; this one does not.
- **Exploitability:** any IPv6 subscriber or rented server. Locally, one address got 30 challenges and
  then 429; 40 addresses of one /64 got 40 challenges in the same window and the 40th was redeemed for
  a session. That Cloudflare puts the full address in the header was assumed, not observed.
- **Impact:** removes the only source-visible bound on A1-01 and on anonymous key generation and
  sealing. Likelihood high, impact low.
- **Fix:** key the limiter with the edge's `sourceKey(request)`. Checked on a scratch copy: 34
  addresses of one /64 gave 30 × 200 then 4 × 429.
- **Other audits:** audit 2 SR-02 (IPv6 part), audit 3 F3. Same finding, three independent PoCs.

### A1-03 — Pairing recovery sends a stored relay resume token to an attacker-supplied cell (Low)

- **Where:** `mobile/src/navigation/use-pairing-links.ts:18`, `mobile/app/pair-confirm.tsx:109`,
  `mobile/src/host-catalog/host-store.ts:100` (host reuse by exact public-key match),
  `mobile/src/pairing/pre-profile-pairing-coordinator.ts:184` (journal written before
  authentication), `mobile/src/pairing/mobile-relay-pairing-recovery.ts:117,192,138`,
  `mobile/src/pairing/mobile-relay-physical-client.ts:106`. Root gap:
  `src/shared/remote-runtime/pairing/mobile-relay-pairing-offer.ts:74` never binds `relayHostId` to
  the offered key.
- **What:** an offer that reuses a known host's public key (not a secret: it is in every pairing
  code and sent in clear during the E2EE handshake) but names a different `relayHostId` and an
  attacker `cellUrl` is aliased onto the existing host. Pairing fails, the journal stays, and on the
  next cold start recovery loads the real host's credential bundle and sends its current resume token
  in a `relay-auth` frame to the attacker's cell.
- **Exploitability:** needs the phone already relay-paired with that host and the user to scan, paste
  or open the attacker's pairing link and tap Pair, on a confirm screen that shows no host identity.
  Native builds only.
- **Impact:** the attacker holds a relay bearer that stays valid at the real relay. It passes the
  outer relay check only; the inner E2EE device authentication still refuses, so no RPC. Likelihood
  low, impact medium.
- **Fix:** derive the expected `relayHostId` from the key in the offer schema and reject a mismatch;
  only replay a stored bundle credential when the journal's relay equals the host's own stored relay
  routing; do not persist a journal aliased onto an existing host before authentication; show the
  host identity on the confirm screen.
- **Other audits:** only this audit. Audit 3 F14 is related (unpinned `cellUrl`) but its attacker is
  the relay operator; here it is anyone who can get one pairing link confirmed.

### A1-04 — Registry-file removal leaves an authenticated socket streaming (Low)

- **Where:** `src/main/runtime/rpc/mobile/mobile-socket-wiring.ts:175,182,245`,
  `src/main/runtime/rpc/server/runtime-rpc-lifecycle.ts:271`,
  `src/main/runtime/rpc/server/pairing/device-registry-store.ts:53`,
  `src/main/runtime/rpc/methods/terminal/terminal-multiplex-frame-delivery.ts:46`.
- **What:** on headless `orcad` the per-device revoke operations are wired only to Electron IPC, so
  removing the row from `orca-devices.json` is the only per-device revoke an operator has. That edit
  stops new sign-ins and closes the device's socket on its next inbound application frame, but
  nothing closes a socket that stays silent. It keeps its E2EE session and every stream it subscribed
  to. WebSocket pings do not count as application frames.
- **Exploitability:** a previously paired device with a session open at the moment of removal, running
  a client that sends nothing. Locally 2,752,512 bytes of terminal output reached the removed device
  after the host had adopted the removal, across three heartbeat sweeps. It cannot type or call
  methods: its first frame closes the socket.
- **Impact:** read-only disclosure of later terminal output on one host. Likelihood low, impact
  medium.
- **Fix:** sweep authenticated sockets once a second and close any whose principal no longer
  resolves; add a headless revoke command. Until then, restart the service after editing the file.
- **Other audits:** only this audit. It qualifies audit 3's statement that revocation driven from
  `orcad` terminates the live socket immediately: true for the in-process revoke, not for the file
  edit that headless hosts are left with.

### A1-05 — Registry-file revoke skips relay and push revocation (Low)

- **Where:** `src/main/runtime/rpc/server/pairing/device-registry-store.ts:56` (`adoptExternalEdits`),
  `src/main/runtime/rpc/server/pairing/device-registry-disk-merge.ts:87`,
  `src/main/runtime/rpc/server/pairing/device-registry.ts:196`,
  `src/main/runtime/push/push-dispatcher.ts:119,179`.
- **What:** the host treats a row that vanished from the file as a data refresh. It queues no relay
  `device-revoke` and no push unregister, and the push dispatcher reads the in-memory list without
  re-reading the file. So the host keeps sending alert previews (title up to 80 and body up to 180
  characters) to the removed phone until something else makes the registry re-read the file, bounded
  by the 7-day registration expiry on an unattended host; the phone's relay resume token keeps passing
  the relay's outer check for up to 30 days; and its push token stays stored at the Worker.
- **Exploitability:** holder of a previously paired phone; for push it does nothing at all.
- **Impact:** no RPC, terminal or file access. Alert previews leak, and the removed phone can make the
  relay refuse the host's other phones for about 10 s per round. Low / low.
- **Fix:** treat a disk removal as a revocation (queue the relay revoke and push unregister, close
  connections); have the dispatcher adopt edits before selecting targets; reconcile Worker rows
  against the registry on connect.
- **Other audits:** only this audit. Audit 3 F4 note (a) describes the outbox delay for the in-process
  revoke; this path never reaches the outbox.

### A1-06 — A failed relay revoke is not retried on a live broker (Low)

- **Where:** `src/main/runtime/mobile-cloud-relay/desktop-relay-service.ts:142,273` (`flushRevoke`),
  `src/main/runtime/mobile-cloud-relay/session-lifecycle/relay-session-broker.ts:145`,
  `src/main/runtime/mobile-cloud-relay/origin-lifecycle/relay-origin-pool.ts:138`,
  `src/main/runtime/mobile-cloud-relay/authentication/relay-auth-coordinator.ts:212`.
- **What:** the host sends each queued `device-revoke` once. If that attempt fails (control socket
  reset or half-open, request dropped, `control-error`), the item stays in the durable outbox and
  nothing sends it again while the same broker lives, which is normally until the process exits,
  because the broker repairs its control connection in place.
- **Exploitability:** the holder of the revoked phone cannot cause the failure; it needs the revoke to
  coincide with a connection fault. Reproduced with network-level fault injection between the real
  host service and the local Worker.
- **Impact:** the revoked phone still passes the relay's outer check and can occupy some of the host's
  8 relay connections. The inner authentication refused it in the local run. Low / low.
- **Fix:** give the outbox a retry loop with bounded backoff and drain it whenever the broker reports
  `registered` again. Checked on a scratch copy for both fault cases.
- **Other audits:** only this audit (extends audit 3 F4 note (a), which calls the delay brief).

### A1-07 — A bare 4401 close disables a valid relay credential on the phone (Low)

- **Where:** `cloud/apps/relay-edge/src/splice-relay.ts:30,254` (2 s first-frame deadline, closed
  with 4401 and no `relay-hello`), `mobile/src/transport/relay/relay-credential-eligibility.ts:18,42`,
  `mobile/src/transport/relay/mobile-relay-reconnect-controller.ts:266`,
  `mobile/src/transport/connection/mobile-endpoint-supervisor.ts:245,272`.
- **What:** the phone decides "the relay rejected my credential" from close code 4401 alone. The relay
  uses the same code for its first-frame timeout, when it never saw the credential. The phone then
  marks the credential rejected and stops dialling the relay for that host until the app restarts or
  the phone reaches the desktop directly.
- **Exploitability:** anyone on the phone's network path who delays its packets for just over 2 s
  after the upgrade, with no credential and without reading traffic; also happens on a bad link.
  Reproduced with a loopback TCP forwarder holding the phone's bytes for 2.6 s, with a 500 ms control.
- **Impact:** availability of the relay path for one phone to one host. Low / low.
- **Fix:** treat 4401 as a rejection only when the relay sent a `relay-hello` refusal (the predicate
  `isExplicitCredentialRejection` already exists in the same file); on the relay, use a different
  close code for the first-frame timeout.
- **Other audits:** only this audit.

### A1-08 — Unclamped invite expiry timer on the host (Low)

- **Where:** `src/main/runtime/mobile-cloud-relay/control-channel/relay-control-client.ts:225`,
  `.../control-channel/relay-control-requests.ts:137`, `.../session-lifecycle/relay-session-broker.ts:135`,
  `.../desktop-relay-service.ts:128,315` (`refreshDemand`), `.../demand/relay-demand-ledger.ts:64`,
  `src/main/runtime/rpc/server/runtime-rpc-pairing.ts:81`.
- **What:** the relay's `invite-created` reply carries `expiresAt`. The host stores it unchanged and
  later passes `expiresAt - now + 1` to `setTimeout`. Node turns any delay above 2^31−1 ms into 1 ms,
  and the callback re-arms itself, so one reply with an expiry more than 24.8 days ahead produces a
  reconcile loop of about 900 iterations a second. The value is persisted before the pairing-offer
  encoder applies its 10-minute bound, so the loop resumes after restart, and the host cannot register
  with the relay again while the row remains.
- **Exploitability:** only the relay end of the host's authenticated control socket can send it (the
  operator of the Worker, or someone who has compromised it), and the owner must have asked for a
  Relay pairing code. The Worker in this repository stamps the expiry from its own clock.
- **Impact:** persistent host-side loop and loss of the relay path until the owner rotates or revokes
  the pending pairing code. The process stays responsive. Low / low.
- **Fix:** reject an expiry outside the invite lifetime plus skew where it enters; validate the offer
  before persisting the binding; treat an out-of-window stored expiry as lapsed in `RelayDemandLedger`
  (do not delete the field: a binding without it counts as an installed credential); clamp the timer.
- **Other audits:** only this audit.

## Proofs of concept

Five of the eight confirmed findings have a PoC committed under
`cloud/seal-relay/test/security/audit-1/`. Each one passes while the weakness exists, so a fix makes
it fail by design. They are therefore skipped unless `SEAL_SECURITY_POC=1` is set: CI (`pnpm test`
in `cloud/seal-relay`) collects the four `*.test.ts` files and reports them as skipped. The two
`*.poc.ts` suites import phone and host code that the Worker's test config cannot load, so they are
loaded by `phone-and-host-suites.test.ts` and only under their own config.

| Finding | File                                   | What it shows                                                                                                                                   |
| ------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| A1-01   | `anonymous-object-storage.test.ts`     | Anonymous resolve, challenge and session requests leave SQLite tables on disk that are still there after the Worker restarts                    |
| A1-02   | `host-auth-limiter-ipv6.test.ts`       | One IPv6 address is stopped at 30 challenges a minute; 40 addresses of one /64 get 40 in the same minute                                        |
| A1-03   | `pairing-recovery-resume-token.poc.ts` | After an interrupted pairing, recovery opens the attacker-supplied cell and sends it the resume token of an already paired host                 |
| A1-04   | `registry-removal-open-session.poc.ts` | A silent socket keeps receiving terminal output after its row is removed from the registry file; the in-process revoke closes it (control)      |
| A1-05   | `registry-file-revoke.test.ts`         | After the row is removed from the registry file, push delivery, the relay credential and the push registration are all still live at the Worker |

Run them from `cloud/seal-relay`:

```sh
# A1-01, A1-02, A1-05: the Worker's own test config
SEAL_SECURITY_POC=1 pnpm test test/security/audit-1

# A1-03, A1-04: these import phone and host code, so they need their own config
SEAL_SECURITY_POC=1 pnpm exec vitest run --config test/security/audit-1/vitest.poc.config.ts
```

Last run from the committed sources at `95dd0be`, in this branch's checkout: 4 of 4 and 3 of 3 tests
passed with the variable set; without it, 5 skipped and the Worker's existing 6 tests passed. They
have not been run against `291fb3ac`.

A1-06, A1-07 and A1-08 were reproduced in the audit sandbox only. Each needs a fault-injection
harness between the host and the Worker (a failed revoke response, a delayed first frame, a relay
that returns a far-future expiry), and those harnesses are not committed.

## Needs validation

Five records where the code path is real and its local part was reproduced, but whether there is any
harm depends on something outside the repository. They carry no severity. Each has an owner-side
check that does not involve attacking anything.

| ID     | What                                                                                                                                                                                                | Where                                                                                                                                           | What decides it                                                                                                      | Other audits                                                                                                           |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| A1-NV1 | Routes behind a host session (`/v1/host/relay-token`, `/v1/devices`, `/v1/send`) have no request limiter, though the contract defines one                                                           | `cloud/seal-relay/src/index.ts:224`, `relay-token.ts:32`, `seal-push-host.ts:88`                                                                | The account's Workers plan and how Durable Object requests and rows written are billed; any zone rule on those paths | Audit 3 F3 (billing remark)                                                                                            |
| A1-NV2 | Push send quota (300 per 15 min) is per self-issued host key; all keys send through one APNs key and one FCM project with no aggregate bound                                                        | `cloud/seal-relay/src/seal-push-host.ts:170,154`, `apns-sender.ts:66`                                                                           | Whether Apple or Google throttle or penalise the shared credential                                                   | Audit 3 F12(a), audit 2 SR-01                                                                                          |
| A1-NV3 | A dismiss push from a host the phone is not paired with adds an uncapped 24-hour entry to the phone's dismissal ledger, before the paired-host check                                                | `mobile/src/notifications/dismissal/push-dismissal-watermarks.ts:81`, `push-background-dismissal.ts:26`, `push-tray-dismissal.ts:48`            | Device behaviour at size (AsyncStorage, UserDefaults) and provider delivery rates; needs a phone or emulator         | Only this audit                                                                                                        |
| A1-NV4 | A removed host keeps the phone's raw push token (no unregister is sent when the host is offline, and none is retried), and the phone filters by paired host only while the app is in the foreground | `mobile/src/notifications/push-registration.ts:171,269`, `foreground-delivery/push-receive.ts:104`, `cloud/seal-relay/src/seal-push-host.ts:72` | Whether iOS and Android show the banner without running the app's filter; needs a device                             | Audit 3 F12(b) covers re-registering a known token; this adds how a removed host has it and the foreground-only filter |
| A1-NV5 | Every push-host object signs its own APNs provider token, and parallel deliveries each sign one                                                                                                     | `cloud/seal-relay/src/apns-sender.ts:41,70`, `push-providers.ts:105`                                                                            | How Apple enforces `TooManyProviderTokenUpdates` (per connection or per key)                                         | Only this audit                                                                                                        |

Owner checks, in short: in the Cloudflare dashboard record the Workers plan, any WAF or rate rule on
the two hostnames, whether IPv6 is enabled and whether billing notifications are set (A1-NV1, A1-NV2,
and the unobserved parts of A1-01 and A1-02); look at the FCM quota page and Apple's delivery logs for
throttling (A1-NV2, A1-NV5); and on a test phone with a throwaway host key, remove the host while it is
offline, background the app and have that host send one notification (A1-NV4).

## Unverified candidates

Not findings. Each lacks a verification the skill requires, for the reason given under
[Run status](#run-status-incomplete). What is stated here is the unverified claim.

| ID    | Claim                                                                                                                                                                                                                                                                                                               | Where                                                                                                                                                                                                                                                                      | What was established                                                                                                                                                                                                 | What is missing                                                                           |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| A1-U1 | A self-registered host can persist unlimited device and install rows through control commands: `device-credential-install` and `device-revoke` have no rate window or per-host cap (only `invite-create` has one), and cleanup never reaps `relay_devices` or `relay_install_results`                               | `cloud/apps/relay-edge/src/host-relay-control.ts:161,167`, `cloud/apps/relay/src/credentials/credential-store.ts:356,406,458`                                                                                                                                              | The hunter's local run: 40 of 40 installs accepted, with the rate-limited sibling command as control. Hunter rating: low                                                                                             | Independent validation never ran                                                          |
| A1-U2 | Every phone frame sent while a splice is still in its auth phase triggers a full host authorization, so one admitted unauthenticated socket can queue hundreds of credential lookups on the shared host object and delay another phone's authorization                                                              | `cloud/apps/relay-edge/src/splice-relay.ts:57,64,115`, `host-relay-phones.ts:56,92`                                                                                                                                                                                        | The hunter's local run: 300 frames → 300 authorizations; a second phone's `conn-open` delay grew from 5 ms to 1,225 ms at 1,000 frames. Hunter rating: medium                                                        | Independent validation never ran. Audit 3 F6 reports the same root cause with its own PoC |
| A1-U3 | A `host-challenge` from the relay that decrypts but fails enough transcript checks produces a close reason over 123 bytes; `ws` throws synchronously inside the message listener, and the headless host treats the uncaught exception as fatal and exits with code 1. Sender: the relay endpoint only               | `src/main/runtime/mobile-cloud-relay/control-channel/relay-control-client.ts:77,203,253,290`, `relay-host-proof.ts:100`, `src/main/orcad/host-lifecycle/orcad-process-error-guards.ts:67`                                                                                  | An independent validator confirmed it at low severity with a local reproduction. The second verifier then proposed a materially different record (wider impact: the whole headless process, not only the relay path) | The fresh verifier required for a changed record was blocked                              |
| A1-U4 | The phone uses its bearer device token as its terminal client id, and the host sends that value in `driver-changed` events to every other paired device viewing the same terminal. Presented on the direct listener it signs in as the phone, and keeps working after the receiving device's own pairing is removed | `src/main/runtime/rpc/methods/terminal/terminal-multiplex-live-stream.ts:35`, `terminal-multiplex-stream-initialization.ts:38`, `src/main/runtime/terminal/driver/runtime-terminal-driver-controller.ts:59,102`, `src/main/runtime/rpc/server/pairing/device-entry.ts:141` | An independent validator confirmed it at low severity with a local reproduction. The recipient is already a paired device with shell-equivalent access. The second verifier proposed a materially different record   | The fresh verifier required for a changed record was blocked                              |

A1-U1, A1-U3 and A1-U4 appear only in this audit.

## Rejected after validation

- **Phone-connect fallback when `allocateConnId` rejects** (`cloud/apps/relay-edge/src/index.ts`).
  The trace is accurate, but no anonymous client can make the call reject (it was reproduced only by
  overriding the method in a test), and its effect equals one `/v1/resolve` call. Fix the catch to
  answer "not on this cell" when A1-01 is fixed.
- **Unbounded first-frame parse and default-off splice flood guard** (`splice-relay.ts`). The only
  unauthenticated work is one `JSON.parse` per socket, linear in what the sender transmits, behind
  the pre-auth limiter and a 2 s deadline. The buffering and no-idle-timeout parts are reachable only
  by an already-authorized phone against its own host's slot. Recorded as hardening. Audit 3 F5 rates
  the authenticated idle-socket part Medium; the facts agree, the rating differs.

## Workers and Durable Objects specifics

| Topic                               | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Auth on every HTTP route            | Holds. Anonymous by design: `/v1/host/challenge`, `/v1/host/session`, `/v1/resolve` (rate-limited; see A1-01, A1-02). Bearer host session: `/v1/host/relay-token`, `/v1/devices*`, `/v1/send`. Relay JWT: `/v1/assign`. Everything else is 404; the shared edge's admin and spike routes fail the Seal allowlist (`index.ts:39,238-241`). Tested locally: `alg: none`, HS256 keyed with the public JWK, a foreign key with the same `kid` and a swapped payload were all refused.                                                                                                                                                                      |
| Auth on every WebSocket upgrade     | Holds. Host control needs a relay JWT bound to the host key plus a sealed-challenge proof; the host data socket needs a per-connection 32-byte ticket delivered only on the control socket; a phone needs an invite or resume credential in its first frame within 2 s. Wrong key, wrong host, guessed proof and command-before-handshake were each closed with no effect on the seated control. A1-U2 concerns work done before that check, not a bypass.                                                                                                                                                                                             |
| Durable Object id derivation        | `idFromName(relayHostId)`, where the id is 96 bits of SHA-256 of the host public key, and `idFromName(hostFingerprint)` for push. Ids are derivable from a public key and are not secrets; nothing treats them as one. Targeting another host's object needs a second preimage. Splice objects are `<relayHostId>.<slot>` and the per-connection secret is the ticket, not the id. Knowing an id gives a liveness signal only (audit 2 SR-03, audit 3 F8).                                                                                                                                                                                             |
| Cross-tenant isolation              | Holds. One object per host; credential lookups filter by host and compare hashes in constant time. Host A revoking host B's device id, installing against B's connection id or confirming B's connection had no effect on B (local). Push rows, quota and sessions are per fingerprint.                                                                                                                                                                                                                                                                                                                                                                |
| Unbounded resource use and cost DoS | The weak area. A1-01, A1-02, A1-NV1, A1-NV2, A1-U1, A1-U2, plus audit 3 F1. Bounded and checked: 8 connections per host, 64 push devices per host, 300 sends per 15 min per host, 20 recipients per send, 2 s unauthenticated socket lifetime, 120 upgrades per minute per /64. Not limited at all: `/health`, 401 and 404 answers, and a 429 is still a billed request, so a zone-level rule is the only real bound.                                                                                                                                                                                                                                  |
| Secrets in wrangler config          | Clean. `wrangler.toml` holds no secret (names appear in comments only), `workers_dev = false`, `.secrets.json` is written 0600 and git-ignored with `.dev.vars`. CI has a read-only token, no secrets and no deploy step. Hardening: `deploy.md` creates `.dev.vars` with the default umask; add `*.p8` and service-account patterns to `.gitignore`.                                                                                                                                                                                                                                                                                                  |
| CORS                                | No `Access-Control-*` header, no cookie, no redirect, and `Origin` is never read. Authentication is a bearer header or a first WebSocket frame, never ambient, so a cross-site page gains nothing an anonymous client lacks.                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Logging of sensitive data           | The Worker has no `console` call on auth paths and returns fixed bodies; provider error text is not reflected. No observability, logpush or tail consumer is configured. Hardening: an unguarded `JSON.parse` of `RELAY_JWT_PRIVATE_JWK` or `FCM_SERVICE_ACCOUNT_JSON` would put about 10 characters of a malformed secret into the exception log (account owner only); if tracing is ever enabled, note that the APNs URL contains the device token and subrequests forward `Authorization`. The phone's log redactor uses a fixed label list that misses `inviteToken`, `connTicket`, `pushToken` and pairing links; no current log line emits them. |
| APNs token handling                 | Device tokens are validated as even-length hex and only ever appear in `/3/device/<token>` on a fixed Apple host; traversal, newline, query and foreign-environment values were refused with 400 (11 cases, local). Provider fetches use `redirect: 'manual'` and a 10 s timeout. Tokens are never returned to a caller. Gaps: provider token cache is per object (A1-NV5); rows and raw tokens are kept indefinitely with no expiry; any session can register any token (A1-NV4, audit 3 F12); `PUSH_PROVIDER_ORIGIN_OVERRIDE` is honoured in production code if set (audit 2 SR-10).                                                                 |

## Controls that held

Checked against the real Worker and real host code in local workerd, with generated keys:

- A random outer credential: `relay-hello` refused with 4401, no `conn-open` at the host, no RPC.
- A valid invite followed by a plaintext RPC frame with no E2EE hello: closed, nothing delivered.
- A valid invite, a completed v2 hello, then a sealed RPC before `e2ee_auth`: closed, nothing
  delivered.
- A valid invite, then `e2ee_auth` with an unknown device token: closed, nothing delivered.
- A valid invite for device A, then `e2ee_auth` with device B's valid token: closed, nothing
  delivered. The relay-asserted device id must match.
- The relay transport forces E2EE v2; a legacy hello is refused there. The phone pins the host key
  with a constant-time compare; keys are HKDF-derived over the transcript hash; nonces bind session,
  direction, kind and a strict counter, so a replayed or reordered frame fails.
- A data socket can be spliced only to the pending connection whose ticket it holds.
- A revoked or unpaired device cannot regain a relay credential through `pairing.provisionRelay` or a
  replayed request id.
- Compressed frames are inflated only after authentication, with the claimed length capped before
  allocation.
- No synchronous throw was found on the data socket before `e2ee_auth`, so a phone or an anonymous
  client cannot stop the host process that way.

## Cross-reference with audits 2 and 3

Audit 2 is [PR #13](https://github.com/brokespace/seal/pull/13) (Trail of Bits and Semgrep
methodology, ids `SR-*` and `E2EE-*`). Audit 3 is [PR #14](https://github.com/brokespace/seal/pull/14)
(pentest, ids `F*`).

**Found by this audit and at least one other**

| This audit                  | Audit 2 | Audit 3 | Note                                                                                                                    |
| --------------------------- | ------- | ------- | ----------------------------------------------------------------------------------------------------------------------- |
| A1-01                       | SR-02   | F2      | Same root cause. Audit 3 rates it High; this run rated Medium because no loss of service or billing effect was observed |
| A1-02                       | SR-02   | F3      | Same                                                                                                                    |
| A1-NV1                      | —       | F3      | Audit 3 notes limiting is billed in-Worker                                                                              |
| A1-NV2                      | SR-01   | F12(a)  |                                                                                                                         |
| A1-NV4                      | —       | F12(b)  |                                                                                                                         |
| A1-U2 (unverified)          | —       | F6      | Audit 3's PoC independently supports it                                                                                 |
| Rejected flood-guard record | —       | F5      | Rating differs, facts agree                                                                                             |

**Found only by this audit**

A1-03 (resume token sent to an attacker cell), A1-04 (silent socket keeps streaming after a file-edit
revoke), A1-05 (file-edit revoke skips relay and push revocation), A1-06 (failed revoke never
retried), A1-07 (bare 4401 latches the credential off), A1-08 (invite-expiry timer loop), A1-NV3
(dismissal ledger), A1-NV5 (APNs provider token per object), and the unverified A1-U1, A1-U3 and
A1-U4. Also new within A1-01: the `/v1/host/session` path and the fact that the existing sweep can
never reach these objects.

**Reported by the others; how this run treated them**

| Other audit                                      | This run                                             | Comment                                                                                                                                                                                                                          |
| ------------------------------------------------ | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SR-01 / F9 open enrolment (High / Low)           | Recorded as by-design, with an allowlist recommended | This run did not rate it as a finding because the deploy guide documents it. For a one-owner relay it is the single most useful fix; I agree with ranking it first                                                               |
| F1 body buffered before the size check (High)    | Seen, recorded as hardening                          | Under-rated here. The hunter noted the missing stream cap but did not test isolate memory; audit 3 did, with a 64 MiB body. Treat F1 as standing                                                                                 |
| SR-06 `HOST_SESSION_SECRET` unvalidated (Medium) | Seen, recorded as hardening                          | Reproduced locally here too: an empty-string secret is accepted as the HMAC key and a forged session is honoured. Needs an operator error, so not rated; the fix is one length check                                             |
| SR-05 token lifetimes, F11 non-expiring offers   | Hardening                                            | Relay JWT lives 1 h against a 5 min contract constant and has no `iss`; host session is stateless for 24 h; headless pairing offers never expire (observed valid after +400 days)                                                |
| SR-07 / F7 `decodeURIComponent` 500              | Hardening                                            | Seen at `index.ts:195` and `relay-edge/src/index.ts:192`                                                                                                                                                                         |
| SR-03 / F8 resolve and liveness oracle           | Hardening                                            | Bounded by the 96-bit id                                                                                                                                                                                                         |
| SR-08 low-order X25519 points                    | Hardening                                            | Reproduced: the all-zero key yields a session for a tenant nobody owns. Also found that device-key registration accepts low-order Ed25519 keys (own row only)                                                                    |
| SR-10 provider-origin override                   | Hardening                                            |                                                                                                                                                                                                                                  |
| SR-11 / F13 push text not end-to-end encrypted   | Hardening                                            | `deploy.md` says only encrypted frames cross the relay; that is not true of the push path                                                                                                                                        |
| E2EE-02 / F16 no forward secrecy                 | Hardening                                            |                                                                                                                                                                                                                                  |
| F4 revoke leaves live splices                    | Hardening on the relay side                          | The relay does not close a revoked device's splices itself; A1-04, A1-05 and A1-06 are the host-side cases where that matters                                                                                                    |
| F14 unpinned `cellUrl`                           | Hardening                                            | Same attacker as A1-08 and A1-U3: the relay operator                                                                                                                                                                             |
| F10 bind to `0.0.0.0`                            | Partly seen                                          | This run checked that `orcad` never widens a pinned bind address, and that the desktop app does widen to `0.0.0.0` on a Relay offer (hardening). It did not examine the `serve` wrapper's `0.0.0.0` default that audit 3 reports |
| F15 plaintext tokens on disk, `===` compare      | Hardening                                            |                                                                                                                                                                                                                                  |
| F17 compression before encryption                | Not assessed as a side channel                       | This run checked the inflater's bounds only                                                                                                                                                                                      |
| E2EE-01 legacy framing replay (High)             | Out of scope                                         | The legacy fallback exists only on the direct transport, which does not pass through the relay. The relay transport refuses it. Not assessed here                                                                                |
| Supply chain / CI, dependency CVEs               | Hardening notes only                                 | Actions are referenced by mutable tag; the workflow path filter omits shared relay code that is bundled into the Worker                                                                                                          |

## Coverage and limits

- 86 ledger units: 51 covered, 22 linked to the candidate records above, 13 out of scope.
- Out of scope: the direct LAN transport's legacy framing, the renderer UI, SSH and WSL features,
  Orca's own GCE relay cells and director, and release tooling.
- Not observable from source, left as owner checks: the live Cloudflare account settings (plan, WAF
  and rate rules, Always Use HTTPS and HSTS, IPv6, whether logs or tracing are enabled), provider
  behaviour (APNs and FCM quotas and throttling), and real device behaviour for push.
- No iOS or Android runtime was available. Mobile code ran under Node with stand-ins for React Native
  packages; the Swift ledger and the Android push path were read, not run.
- The severity ratings are the skill's and are conservative about unobserved cost: where audit 3 rates
  a cost or DoS issue higher on measured local load, its rating is a fair reading too.

# Forward secrecy and the paired E2EE handshake

This covers audit findings E2EE-01, E2EE-02 / F16, F17 and the E2EE half of SR-08. It describes
the handshake every paired client and host in this repository now speaks, what changed on the wire,
who has to update, and what to do after a host key is exposed.

## Summary

- There is one handshake, E2EE v2 with forward secrecy. It is required on every transport,
  including a direct LAN socket. The legacy framing is deleted on the host and in every client
  (phone, desktop as a remote-runtime client, CLI, web client). No client falls back.
- Each socket is keyed by the host's long-lived identity key **and** a host key generated for that
  socket and wiped after the handshake. A later leak of the identity key file does not open
  recorded sessions.
- Pairing is unchanged. A QR code or pairing offer still pins only the host's long-lived public
  key. Nobody has to pair again.
- Peer-supplied X25519 keys that are low-order points, and any all-zero Diffie-Hellman output, are
  refused. Low-order Ed25519 device keys are refused.
- Frames are not compressed before encryption unless their sender marked them as bulk display
  output from a fixed list of methods.

## Handshake

Both handshake messages are plain JSON and validated as exact records (an extra or missing field
fails). The wire version is still `v: 2`; forward secrecy is a required capability, not a new
version number.

Client to host:

```json
{
  "type": "e2ee_hello",
  "v": 2,
  "clientPublicKeyB64": "<32-byte X25519 key, new for every socket>",
  "clientNonceB64": "<32 random bytes>",
  "capabilities": { "framing": [2], "payloadKinds": ["text", "binary"], "forwardSecrecy": true },
  "context": { "transport": "direct" }
}
```

Host to client:

```json
{
  "type": "e2ee_ready",
  "v": 2,
  "desktopPublicKeyB64": "<the host identity key the client pinned at pairing>",
  "desktopEphemeralPublicKeyB64": "<32-byte X25519 key, new for every socket>",
  "desktopNonceB64": "<32 random bytes>",
  "selection": { "framing": 2, "payloadKinds": ["text", "binary"], "forwardSecrecy": true }
}
```

On the relay transport `context` also carries the relay binding, as before.

### Key schedule

```
static_secret    = X25519(client socket secret, host identity public key)
ephemeral_secret = X25519(client socket secret, host socket public key)
ikm              = static_secret || ephemeral_secret
salt             = SHA-256("orca-mobile-e2ee/v2/salt\0" || client nonce || host nonce)
info             = "orca-mobile-e2ee/v2/forward-secret-session\0" || SHA-256(transcript)
keys             = HKDF-SHA256(ikm, salt, info)
```

`keys` is split into the two direction keys and the session id exactly as before. The `info` label
is new, so a peer running the previous v2 key schedule can never derive the same keys by accident.

The transcript gained three fields, so both sides commit to the forward-secrecy choice and to the
host's per-socket key:

| Field                                            | Position                            |
| ------------------------------------------------ | ----------------------------------- |
| `mobile-to-desktop.capabilities.forward-secrecy` | after the hello's payload kinds     |
| `desktop-to-mobile.desktop-ephemeral-public-key` | after the host identity public key  |
| `desktop-to-mobile.selection.forward-secrecy`    | after the selection's payload kinds |

What each half of `ikm` buys:

- `static_secret` authenticates the host. Only the holder of the identity secret can derive it, so
  an attacker in the middle who substitutes their own per-socket key still cannot finish the
  handshake. The client also checks that `desktopPublicKeyB64` is the key it pinned.
- `ephemeral_secret` gives forward secrecy. Both secrets that produce it exist only for one socket.

After deriving the keys, the host wipes its per-socket secret key and both shared secrets, and the
client wipes its socket secret key and both shared secrets. The client accepts one `e2ee_ready` per
socket; a second one is refused.

Frames are unchanged: NaCl secretbox with a strict in-order counter per direction, so a frame
opens once, in order, on the socket it was sealed for.

### What forward secrecy does and does not cover

- A recording of a past session plus the host identity key (`orca-e2ee-keypair.json`) does not
  yield that session's keys. This includes the device credential sent in `e2ee_auth`.
- It does not protect sessions that start **after** the identity key leaks. Whoever holds the key
  can impersonate the host to a client that connects through them. Recover with
  [`seal serve reset-identity`](#after-a-host-key-is-exposed).
- It does not protect a session whose keys are read out of a running process. Session keys live in
  memory for the life of the socket. Wiping in JavaScript clears the buffers this code owns; the
  runtime may have copied them.
- The client has no long-lived encryption key, so there is nothing on the client side to leak for
  this purpose. Device credentials are a separate matter and are handled by the pairing work.

## Refused keys (SR-08)

`src/shared/remote-runtime/e2ee/x25519-low-order-points.ts` is the one helper for this. It has no
dependencies, so the relay Worker can import it too. It exports:

- `isLowOrderX25519PublicKey(key)`: true for the seven low-order encodings, with the top bit
  masked as X25519 does.
- `isAllZeroX25519SharedSecret(secret)`.
- `contributoryX25519SharedSecret(x25519, ourSecretKey, peerPublicKey)`: refuses a low-order peer
  key before the scalar multiplication and an all-zero result after it. Returns `null` on refusal.

It is applied wherever a peer-supplied key enters:

| Where                                      | Key checked                                         |
| ------------------------------------------ | --------------------------------------------------- |
| Host, on `e2ee_hello`                      | the client's socket key                             |
| Relay pairing offer parser                 | the host identity key about to be pinned            |
| Every client, before it sends `e2ee_hello` | the pinned host identity key                        |
| Every client, on `e2ee_ready`              | the host identity key and the host's per-socket key |
| `publicKeyFromBase64` (node, web, phone)   | any key decoded from base64                         |
| Relay Worker host sign-in (`host-auth.ts`) | the host key presented to the relay                 |

`src/shared/remote-runtime/e2ee/ed25519-low-order-points.ts` does the same for Ed25519.
`isDevicePublicKeyB64` and `verifyDeviceProof` use it, because a signature that anyone can forge
verifies under a low-order key in tweetnacl.

## Compression (F17)

Compressing before encrypting leaks, through the ciphertext length, how much the plaintext repeats
itself. Where an attacker can place chosen text next to a secret in the same frame, that recovers
the secret byte by byte.

The host is the only sender that compresses. It now compresses a frame only when its sender marked
it `compressible`, and that mark is set in three places:

1. Text replies and stream events of a request whose `method` is in
   `src/main/runtime/rpc/mobile/e2ee/mobile-e2ee-compressible-reply-methods.ts`. The list holds
   bulk display output and catalogs: worktree, repo, project, folder workspace, session tab and
   terminal listings, terminal reads and subscriptions, and agent or chat session history.
2. Binary terminal stream frames (`terminal.subscribe`, `terminal.multiplex`).
3. Nothing else. Handshake and control frames (`e2ee_authenticated`, errors), and replies to any
   method not on the list, are sealed at their plain length. That covers auth, pairing, relay and
   push tokens, account and credential export, and file contents.

A request larger than 16 KiB is never classified, so its reply stays plain.

Why an allowlist and not padding: the phone inflates with a native gzip reader that rejects
trailing bytes, so padding the compressed frame would have needed a second wire format. Padding the
plain frame hides less than not compressing at all. An allowlist fails closed: a new method is not
compressed until someone decides it is safe.

Receivers are unchanged and still inflate compressed frames. `ORCA_DISABLE_MOBILE_COMPRESSED_FRAMES=1`
on the host still turns compression off entirely.

Remaining exposure, accepted: terminal output and agent transcripts are on the list because they
are the bulk of the traffic, and they can contain a secret that a user prints (`cat .env`). The
length of that frame then depends on its contents. An attacker would also have to control other
text in the same frame and observe many such frames to exploit it. Operators who do not accept this
can set `ORCA_DISABLE_MOBILE_COMPRESSED_FRAMES=1`.

## Compatibility and migration

Hosts and clients built from this repository interoperate with each other. They do not
interoperate with older builds, in either direction, and this is intended:

| Client                     | Host           | Result                                                         |
| -------------------------- | -------------- | -------------------------------------------------------------- |
| current                    | current        | connects                                                       |
| legacy framing             | current        | host closes `4001 E2EE v2 required`, sends nothing             |
| v2 without forward secrecy | current        | host closes `4001 Invalid e2ee_hello v2`, sends nothing        |
| current                    | any older host | host closes `4001`; client stops with an update-the-host error |

A client never retries with a weaker handshake. When a host closes the socket with `4001` before
`e2ee_ready`, or answers with a ready that lacks the per-socket key:

- the desktop app and CLI report that the host must be updated;
- the web client stops with the `host-outdated` failure and does not reconnect;
- the phone uses its bounded sign-in retries, then stops and records "Host refused the encrypted
  handshake" in diagnostics.

The same close also happens when the host's identity key no longer matches the pinned one, so the
messages name both causes: update the host, and if it is already up to date, pair again.

What operators do:

1. Update the host (desktop app or `seal serve`) and every client (phone app, desktop app, CLI, web
   client) to a build with this change. Order does not matter, but a pair only connects once both
   ends are updated.
2. Do not pair again. Existing pairings keep working, because the pinned host identity key and the
   device credentials are unchanged.
3. The relay Worker needs no change for this. It forwards the handshake without reading it.

Three stores written by older builds are no longer read and can be ignored: `remote-runtime-e2ee-v2-hosts.json`
in the desktop data directory, the `orca.web.e2eeV2Hosts.v1` key in the web client's local storage,
and the `orca:e2ee-v2-hosts` key in the phone's storage.

## After a host key is exposed

Forward secrecy protects what was recorded before the exposure. To protect what comes after, give
the host a new identity:

```bash
# Stop Seal on that machine first.
seal serve reset-identity
```

This replaces the identity key and installation id and removes every paired device, so each client
pairs again and pins the new key. The replaced files move to `orca-identity-backups` in the Seal
data directory; delete that folder if the old key must not remain on disk. See
[Copies of a machine image](../site/content/docs/remote-servers.mdx) for the full behaviour.

## Tests that hold this in place

- `cloud/seal-relay/test/security/legacy-e2ee-replay.test.ts` and `no-forward-secrecy.test.ts`: the
  audit's proofs of concept, now asserting that the attacks fail. They run by default.
- `src/main/runtime/rpc/mobile/e2ee/e2ee-channel-v2.test.ts`: the host refuses legacy and
  non-forward-secret hellos and low-order client keys, keys each socket freshly, and compresses
  only listed replies.
- `src/shared/remote-runtime/e2ee/x25519-low-order-points.test.ts` and the handshake and key
  schedule tests beside it, including fixed vectors shared with the phone.
- `mobile/src/transport/rpc/direct-socket-e2ee-v2-only.test.ts` and
  `src/renderer/src/web/web-runtime-client.test.ts`: clients stop instead of falling back.
- `tests/e2e/cross-version-wire/cross-version-e2ee-forward-secrecy-cutoff.unit.test.ts`: the cut-off
  against the last release before this change.

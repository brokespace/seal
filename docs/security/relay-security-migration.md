# Migrating to the hardened relay, host and phone

What to do on each machine when you take the fixes for the three audits in this folder. The relay
side is in [`relay-deploy.md`](./relay-deploy.md) and the handshake in
[`forward-secrecy.md`](./forward-secrecy.md).

## The short version

1. Update **every** end: the desktop app, each `seal serve` machine, the CLI, and the phone app.
   Old and new builds cannot talk to each other.
2. Note each host's id (`seal relay host-id`), put them in the relay's `HOST_ALLOWLIST`, and deploy
   the relay.
3. Nobody pairs again, with the two exceptions under [Pairing](#pairing).
4. If a `seal serve` machine is reached over the LAN or a tailnet, start it with `--bind`.

## What stops working until you act

| You see                                                                 | Because                                                                                               | Do                                                                                                 |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| A phone or remote desktop says the host must be updated                 | The legacy encrypted framing is gone and every socket now needs the forward-secret v2 handshake       | Update the older end. Do not pair again.                                                           |
| A host never gets push or relay access; the relay answers `403`         | The host's id is not in `HOST_ALLOWLIST`                                                              | Add it (`relay-deploy.md`, section 2).                                                             |
| Every relay request answers `503 relay_misconfigured`                   | `HOST_SESSION_SECRET` is shorter than 32 characters or repetitive, or an allowlist entry is malformed | Fix the secret or the entry.                                                                       |
| A phone on the LAN cannot reach a `seal serve` machine it used to reach | `seal serve` now listens on `127.0.0.1` unless told otherwise                                         | Start it with `--bind <address>` (or `--bind 0.0.0.0`). Without it, phones pair through the relay. |
| An unused pairing QR code or link no longer works                       | Offers now expire: 10 minutes for a phone, 60 minutes for an access link                              | Run `seal pair` (`seal pair --mobile` for a phone) again.                                          |
| A client is refused after many wrong credentials                        | Three failed sign-ins in a row from one source lock it out for 1 second, doubling up to 5 minutes     | Wait, then retry with the right credential.                                                        |

## Pairing

Existing pairings survive the update: the host's identity key and each device's credential are
unchanged, and stored device tokens are converted to hashes in place the first time the new host
reads its registry.

Pair again only when:

- a pairing was **in progress** on the phone when it was updated and the phone abandons it (it
  shows the pairing as failed). Scan a new code;
- you **revoked** the device, or removed its row from the registry file by hand. A removed row is
  now treated as a revocation and the device is cut off at once;
- a phone that has not yet moved to a device key was **unused for more than 30 days**, including
  30 days during which the host was off. Its token has lapsed. A phone that stays connected, or one
  that signs in with a device key, never lapses.

Downgrading a host after it has run the new build is not supported: the old build cannot read
hashed device tokens, so every device would have to pair again.

A copy of a corrupt registry that an older build set aside (`orca-devices.json.corrupt-*` in the
profile folder) can still hold plaintext tokens. Delete those copies once the host is updated.

## What changed in behaviour

**Relay**

- Only allowlisted hosts are served. `/v1/resolve` needs the phone's resume credential and answers
  the same `401` for an unknown host, an offline host and a wrong credential.
- Relay tokens last 5 minutes and host sessions 1 hour (they were 24 hours). Hosts renew both on
  their own.
- A phone socket has 10 seconds to present its credential, gets one attempt per socket, and an idle
  splice is closed after 10 minutes. A host holds at most 8 phone connections, 4 per device, and 64
  paired devices.
- Revoking a device closes its live connections on the relay, not only its next sign-in.

**Hosts (desktop app and `seal serve`)**

- `seal devices list` and `seal devices revoke (<deviceId> | --all)` manage paired devices from a
  shell, with or without Seal running. With Seal stopped, the command edits the profile it resolves
  (`ORCA_USER_DATA_PATH` or the platform default) and the relay and push withdrawals go out on the
  next start.
- A revoke closes the device's sockets, withdraws its relay credential and push registration, and
  retries those withdrawals with backoff until the relay has them.
- A host follows its relay director only to the director itself or to an origin listed in
  `SEAL_RELAY_CELL_ORIGINS`. A single-origin relay needs nothing set.
- `seal serve` binds `127.0.0.1` by default.

**Phone**

- The pairing confirmation screen shows the computer's fingerprint, the relay it will use and
  whether the phone already knows that computer. Compare the fingerprint with
  `seal relay host-id` on the computer when in doubt.
- A phone never sends one host's credential to a relay named by another host's pairing code, and
  follows a relay only to origins its build lists.
- After you remove a host that could not be reached, the phone keeps trying for up to 7 days to
  tell that host to stop sending it notifications.

## Environment variables

| Variable                                | Where        | Meaning                                                                              |
| --------------------------------------- | ------------ | ------------------------------------------------------------------------------------ |
| `HOST_ALLOWLIST`                        | relay secret | Host ids allowed to use the relay. Unset: none.                                      |
| `SEAL_RELAY_CELL_ORIGINS`               | host         | Extra HTTPS origins a host accepts as its relay cell. Not needed for a single relay. |
| `ORCA_DISABLE_MOBILE_COMPRESSED_FRAMES` | host         | `1` turns off compression of bulk display frames entirely.                           |

Removed: `PUSH_PROVIDER_ORIGIN_OVERRIDE` on the relay. It was a test hook and is no longer read.

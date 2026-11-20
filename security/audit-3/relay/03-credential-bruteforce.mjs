#!/usr/bin/env node
// Attacker: external, no paired device; knows (or has guessed) the victim's relay host id.
// Guesses the phone credential (pairing invite / resume token) at /v1/connect/<hostId>:
//  - one source gets a bounded number of guesses per minute, and pipelining frames on one socket
//    must not multiply that (one credential is judged per socket);
//  - wrong guesses must not lock the real phone's invite out (pairing DoS);
//  - what the keyspace makes of the limiter rate.
import {
  createInvite,
  finish,
  freshSourceIp,
  hostOnline,
  nextConnOpen,
  phoneAttempt,
  phoneOpen,
  randomToken,
  relayAuthFrame,
  relayOrigin,
  report,
  setSourceIp,
  splice
} from '../lib/relay-protocol.mjs'

// PREAUTH_LIMITER in wrangler.toml: unauthenticated phone upgrades per source per minute.
const UPGRADES_PER_MINUTE = 120
const origin = relayOrigin()
setSourceIp(freshSourceIp())
const victim = await hostOnline(origin)
const hostId = victim.keys.hostId

// ---- guesses per minute from one source ----
{
  setSourceIp(freshSourceIp())
  const started = Date.now()
  let admitted = 0
  let rejected4401 = 0
  let limited = false
  // The local limiter counts per wall-clock minute, so a burst over a boundary gets two budgets.
  while (!limited && admitted <= 2 * UPGRADES_PER_MINUTE) {
    const attempt = await phoneAttempt(origin, hostId)
    if (attempt.upgrade === 429) {
      limited = true
    } else {
      admitted++
      rejected4401 += attempt.hello?.code === 4401 ? 1 : 0
    }
  }
  report(
    'guesses admitted from one source before the pre-auth limiter answers 429',
    limited && rejected4401 === admitted ? 'blocked' : 'VULNERABLE',
    { admitted, limited, rejected4401, seconds: Number(((Date.now() - started) / 1000).toFixed(1)) }
  )
}

// ---- several guesses on one socket ----
// The right credential goes LAST, after wrong ones, in a single burst on a single upgrade. If the
// host sees a conn-open, the relay evaluated more than one credential per admitted socket.
setSourceIp(freshSourceIp())
for (const wrongFirst of [1, 16, 256, 2000]) {
  const invite = await createInvite(victim.control)
  const phone = await phoneOpen(origin, hostId)
  for (let i = 0; i < wrongFirst; i++) {
    phone.ws.send(relayAuthFrame(randomToken()))
  }
  phone.ws.send(relayAuthFrame(invite.inviteToken))
  const close = await phone.waitClosed(4000)
  const open = await nextConnOpen(victim.control, 500)
  report(
    `pipelining: ${wrongFirst} wrong credential(s) then the right one on one socket`,
    !open && close?.code === 4401 ? 'blocked' : 'VULNERABLE',
    { hostSawConnOpen: Boolean(open), close }
  )
  phone.ws.terminate()
}

// ---- can an outsider burn the real phone's invite? ----
setSourceIp(freshSourceIp())
const invite = await createInvite(victim.control)
for (let i = 0; i < 20; i++) {
  await phoneAttempt(origin, hostId)
}
const legit = await splice(origin, victim, invite.inviteToken)
report(
  '20 wrong guesses, then the real phone redeems its invite',
  legit.hello?.ok === true ? 'blocked' : 'VULNERABLE',
  { hello: legit.hello }
)
legit.phone.ws.terminate()

// ---- keyspace ----
const years = 2 ** 255 / UPGRADES_PER_MINUTE / 60 / 24 / 365
report(
  `expected time to guess a 256-bit credential at the limiter rate (${UPGRADES_PER_MINUTE}/min/source)`,
  'info',
  {
    reason: 'arithmetic, not an attack: one guess per admitted upgrade',
    credentialBits: 256,
    expectedYearsPerSource: years.toExponential(2)
  }
)
victim.control.ws.terminate()
finish()

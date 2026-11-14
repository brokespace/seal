#!/usr/bin/env node
// Attacker: external, no paired device; knows (or has guessed) the victim's relay host id.
// Guesses the phone credential (pairing invite / resume token) at /v1/connect/<hostId>:
//  - how many guesses per minute one source gets, and whether pipelining frames on one socket
//    multiplies that;
//  - whether wrong guesses can lock the real phone's invite out (pairing DoS);
//  - what the keyspace makes of the measured rate.
import { randomBytes } from 'node:crypto'
import {
  createInvite,
  freshSourceIp,
  hostOnline,
  nextConnOpen,
  phoneOpen,
  relayAuthFrame,
  relayOrigin,
  report,
  setSourceIp,
  sleep,
  splice
} from '../lib/relay-protocol.mjs'

const origin = relayOrigin()
setSourceIp(freshSourceIp())
const victim = await hostOnline(origin)
const hostId = victim.keys.hostId
const guess = () => randomBytes(32).toString('base64url')

// ---- guesses per minute from one source ----
setSourceIp(freshSourceIp())
const started = Date.now()
let admitted = 0
let limited = 0
let rejected4401 = 0
const ATTEMPTS = Number(process.env.ATTEMPTS ?? 200)
for (let i = 0; i < ATTEMPTS; i++) {
  const phone = await phoneOpen(origin, hostId)
  if (phone.upgradeStatus === 429) {
    limited++
    continue
  }
  admitted++
  phone.ws.send(relayAuthFrame(guess()))
  const hello = await phone.nextJson(3000)
  if (hello?.code === 4401) {
    rejected4401++
  }
  phone.ws.terminate()
}
const seconds = (Date.now() - started) / 1000
// The local limiter is a fixed 60 s window: a burst that straddles a window boundary gets up to 2x.
report(
  'guesses admitted from one source before the pre-auth limiter answers 429',
  limited > 0 ? 'blocked (rate limited)' : 'info (burst straddled a limiter window; re-run)',
  {
    attempts: ATTEMPTS,
    admitted,
    limited,
    rejected4401,
    seconds: Number(seconds.toFixed(1))
  }
)

// ---- several guesses on one socket ----
// The right credential goes LAST, after wrong ones, in a single burst on a single upgrade. If the
// host sees a conn-open, the relay evaluated more than one credential per admitted socket.
setSourceIp(freshSourceIp())
for (const wrongFirst of [1, 16, 256, 2000]) {
  const invite = await createInvite(victim.control)
  const phone = await phoneOpen(origin, hostId)
  for (let i = 0; i < wrongFirst; i++) {
    phone.ws.send(relayAuthFrame(guess()))
  }
  phone.ws.send(relayAuthFrame(invite.inviteToken))
  const open = await nextConnOpen(victim.control, 2500)
  report(
    `pipelining: ${wrongFirst} wrong credential(s) then the right one on one socket`,
    open ? 'VULNERABLE (several guesses per socket)' : 'blocked (first frame decides)',
    {
      hostSawConnOpen: Boolean(open),
      close: await phone.waitClosed(1500)
    }
  )
  phone.ws.terminate()
  await sleep(200)
}

// ---- can an outsider burn the real phone's invite? ----
setSourceIp(freshSourceIp())
const invite = await createInvite(victim.control)
for (let i = 0; i < 20; i++) {
  const phone = await phoneOpen(origin, hostId)
  phone.ws.send(relayAuthFrame(guess()))
  await phone.nextJson(2000)
  phone.ws.terminate()
}
const legit = await splice(origin, victim, invite.inviteToken)
report(
  '20 wrong guesses, then the real phone redeems its invite',
  legit.hello?.ok === true ? 'blocked (invite unaffected)' : 'VULNERABLE (pairing lockout)',
  { hello: legit.hello }
)
legit.phone.ws.terminate()

// ---- keyspace ----
const perMinute = 120
const years = 2 ** 255 / perMinute / 60 / 24 / 365
report('expected time to guess a 256-bit credential at the limiter rate (120/min/source)', 'info', {
  credentialBits: 256,
  expectedYearsPerSource: years.toExponential(2)
})
victim.control.ws.terminate()
process.exit(0)

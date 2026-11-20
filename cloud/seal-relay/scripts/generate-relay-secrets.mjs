#!/usr/bin/env node
// Writes .secrets.json for `wrangler secret bulk`. Re-running rotates every key: paired desktops
// re-authenticate on their own, but keep the file if you only want to add APNs/FCM values.
//   node scripts/generate-relay-secrets.mjs [--apns-p8 AuthKey_XXXX.p8 --apns-key-id XXXX --apns-team-id YYYY] [--fcm-json sa.json]
import { randomBytes, webcrypto } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'

const { values } = parseArgs({
  options: {
    out: { type: 'string', default: '.secrets.json' },
    force: { type: 'boolean', default: false },
    'apns-p8': { type: 'string' },
    'apns-key-id': { type: 'string' },
    'apns-team-id': { type: 'string' },
    'fcm-json': { type: 'string' }
  }
})

if (existsSync(values.out) && !values.force) {
  console.error(`${values.out} exists; pass --force to rotate every key`)
  process.exit(1)
}

const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
  'sign',
  'verify'
])
const kid = randomBytes(8).toString('hex')
const privateJwk = {
  ...(await webcrypto.subtle.exportKey('jwk', pair.privateKey)),
  kid,
  alg: 'ES256',
  use: 'sig'
}
const publicJwk = {
  ...(await webcrypto.subtle.exportKey('jwk', pair.publicKey)),
  kid,
  alg: 'ES256',
  use: 'sig'
}
delete privateJwk.key_ops
delete publicJwk.key_ops

const secrets = {
  RELAY_JWT_PRIVATE_JWK: JSON.stringify(privateJwk),
  RELAY_JWKS: JSON.stringify({ keys: [publicJwk] }),
  HOST_SESSION_SECRET: randomBytes(32).toString('base64url'),
  ADMIN_SIGNING_KEY: randomBytes(32).toString('base64url')
}

const apnsArgs = [values['apns-p8'], values['apns-key-id'], values['apns-team-id']]
if (apnsArgs.some(Boolean)) {
  if (!apnsArgs.every(Boolean)) {
    console.error('--apns-p8, --apns-key-id and --apns-team-id go together')
    process.exit(1)
  }
  secrets.APNS_PRIVATE_KEY = readFileSync(values['apns-p8'], 'utf8').trim()
  secrets.APNS_KEY_ID = values['apns-key-id']
  secrets.APNS_TEAM_ID = values['apns-team-id']
}
if (values['fcm-json']) {
  secrets.FCM_SERVICE_ACCOUNT_JSON = JSON.stringify(
    JSON.parse(readFileSync(values['fcm-json'], 'utf8'))
  )
}

writeFileSync(values.out, `${JSON.stringify(secrets, null, 2)}\n`, { mode: 0o600 })
console.log(`Wrote ${Object.keys(secrets).join(', ')} to ${values.out}`)
console.log(`Upload with: npx wrangler secret bulk ${values.out}`)

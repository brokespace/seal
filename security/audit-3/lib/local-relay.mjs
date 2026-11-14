#!/usr/bin/env node
// Starts the Seal relay Worker locally (workerd through wrangler's dev API, the same runtime as
// `wrangler dev`) with throwaway secrets, plus a fake APNs/FCM endpoint that records deliveries.
// Nothing here talks to Cloudflare, Apple or Google, and nothing is deployed.
//
//   node security/audit-3/lib/local-relay.mjs [--port 8787] [--state-dir /tmp/seal-audit3]
//        [--expose-operator-secrets]   also write the generated secrets (mode 600) for the
//                                      "malicious relay operator" scripts
//        [--no-ratelimits]             drop the Rate Limiting bindings (to probe what is left)
import { generateKeyPairSync, randomBytes, webcrypto } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, appendFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { RELAY_DIR, loadWrangler } from './deps.mjs'

const { values } = parseArgs({
  options: {
    port: { type: 'string', default: '8787' },
    'state-dir': { type: 'string', default: '/tmp/seal-audit3' },
    'expose-operator-secrets': { type: 'boolean', default: false },
    'no-ratelimits': { type: 'boolean', default: false }
  }
})
const stateDir = values['state-dir']
const port = Number(values.port)
mkdirSync(stateDir, { recursive: true })
const persistDir = join(stateDir, 'relay-state')
rmSync(persistDir, { recursive: true, force: true })
const pushLog = join(stateDir, 'provider-requests.jsonl')
writeFileSync(pushLog, '')

// Fake APNs / FCM / Google OAuth. Logs path and payload only: never the provider bearer token.
const providers = createServer((req, res) => {
  const chunks = []
  req.on('data', (chunk) => chunks.push(chunk))
  req.on('end', () => {
    appendFileSync(
      pushLog,
      `${JSON.stringify({ at: Date.now(), path: req.url, body: Buffer.concat(chunks).toString('utf8') })}\n`
    )
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(
      req.url?.includes('oauth2') ? JSON.stringify({ access_token: 'fake', expires_in: 3600 }) : ''
    )
  })
})
await new Promise((resolve) => providers.listen(0, '127.0.0.1', resolve))
const providersOrigin = `http://127.0.0.1:${providers.address().port}`

const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
  'sign',
  'verify'
])
const privateJwk = {
  ...(await webcrypto.subtle.exportKey('jwk', pair.privateKey)),
  kid: 'audit',
  alg: 'ES256'
}
const publicJwk = {
  ...(await webcrypto.subtle.exportKey('jwk', pair.publicKey)),
  kid: 'audit',
  alg: 'ES256'
}
const apns = generateKeyPairSync('ec', { namedCurve: 'P-256' })
const secrets = {
  RELAY_JWT_PRIVATE_JWK: JSON.stringify(privateJwk),
  RELAY_JWKS: JSON.stringify({ keys: [publicJwk] }),
  HOST_SESSION_SECRET: randomBytes(32).toString('base64url'),
  ADMIN_SIGNING_KEY: randomBytes(32).toString('base64url'),
  APNS_TEAM_ID: 'AUDITTEAM1',
  APNS_KEY_ID: 'AUDITKEY01',
  APNS_PRIVATE_KEY: apns.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
  PUSH_PROVIDER_ORIGIN_OVERRIDE: providersOrigin
}

let config = join(RELAY_DIR, 'wrangler.toml')
if (values['no-ratelimits']) {
  // A copy of the real config minus the [[ratelimits]] tables; it must live next to the original
  // because its paths are relative.
  config = join(RELAY_DIR, '.wrangler-audit-no-ratelimits.toml')
  writeFileSync(
    config,
    readFileSync(join(RELAY_DIR, 'wrangler.toml'), 'utf8').replace(/\[\[ratelimits\]\][^[]*/g, '')
  )
}

const { unstable_startWorker } = loadWrangler()
const worker = await unstable_startWorker({
  config,
  bindings: Object.fromEntries(
    Object.entries(secrets).map(([name, value]) => [name, { type: 'plain_text', value }])
  ),
  dev: {
    server: { hostname: '127.0.0.1', port },
    // Keep the URL the Worker sees equal to what clients dial (proof transcripts bind the origin).
    origin: { hostname: `127.0.0.1:${port}`, secure: false },
    inspector: false,
    persist: persistDir,
    logLevel: 'warn'
  }
})
await worker.ready
const origin = (await worker.url).origin

writeFileSync(
  join(stateDir, 'relay.json'),
  `${JSON.stringify({ origin, providersOrigin, persistDir, pushLog, pid: process.pid }, null, 2)}\n`
)
if (values['expose-operator-secrets']) {
  writeFileSync(join(stateDir, 'operator-secrets.json'), `${JSON.stringify(secrets)}\n`, {
    mode: 0o600
  })
}
console.log(`seal-relay (local) listening on ${origin}; state in ${stateDir}`)

const stop = async () => {
  await worker.dispose().catch(() => {})
  providers.close()
  if (values['no-ratelimits']) {
    rmSync(config, { force: true })
  }
  process.exit(0)
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)

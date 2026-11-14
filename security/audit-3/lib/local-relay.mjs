#!/usr/bin/env node
// Starts the Seal relay Worker locally (workerd through wrangler's dev API, the same runtime as
// `wrangler dev`) with throwaway secrets, a pool of enrolled host keys, and a fake APNs/FCM
// endpoint that records deliveries. Nothing here talks to Cloudflare, Apple or Google, and nothing
// is deployed.
//
//   node security/audit-3/lib/local-relay.mjs [--port 8787] [--state-dir /tmp/seal-audit3]
//        [--hosts 64]                  size of the enrolled host pool (HOST_ALLOWLIST)
//        [--expose-operator-secrets]   also write the generated secrets (mode 600) for the
//                                      "malicious relay operator" checks
//        [--splice-idle-timeout-ms N]  shorten the 10 min splice idle timeout (07 needs it)
//        [--no-ratelimits]             drop the Rate Limiting bindings: the routes they guard
//                                      must then refuse (429), not run unlimited
import { generateKeyPairSync, randomBytes, webcrypto } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { RELAY_DIR, loadWrangler } from './deps.mjs'
import { hostIdOf, nacl } from './relay-protocol.mjs'
import { logProviderRequest, writeRelayState } from './relay-state.mjs'

const { values } = parseArgs({
  options: {
    port: { type: 'string', default: '8787' },
    'state-dir': { type: 'string', default: '/tmp/seal-audit3' },
    hosts: { type: 'string', default: '64' },
    'expose-operator-secrets': { type: 'boolean', default: false },
    'splice-idle-timeout-ms': { type: 'string' },
    'no-ratelimits': { type: 'boolean', default: false }
  }
})
const stateDir = resolve(values['state-dir'])
const port = Number(values.port)
mkdirSync(stateDir, { recursive: true })
const persistDir = join(stateDir, 'relay-state')
rmSync(persistDir, { recursive: true, force: true })
const pushLog = join(stateDir, 'provider-requests.jsonl')
writeFileSync(pushLog, '')

// Fake APNs / FCM / Google OAuth.
const providers = createServer((req, res) => {
  const chunks = []
  req.on('data', (chunk) => chunks.push(chunk))
  req.on('end', () => {
    logProviderRequest(pushLog, { path: req.url, body: Buffer.concat(chunks).toString('utf8') })
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(
      req.url?.includes('oauth2') ? JSON.stringify({ access_token: 'fake', expires_in: 3600 }) : ''
    )
  })
})
await new Promise((resolve) => providers.listen(0, '127.0.0.1', resolve))
const providersOrigin = `http://127.0.0.1:${providers.address().port}`
// The production Worker used to send provider traffic wherever this variable said; 08 checks that
// nothing arrives under this path any more.
const providerOverrideDecoy = '/override-honoured'

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
  APNS_PRIVATE_KEY: apns.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString()
}
const enrolledHosts = Array.from({ length: Number(values.hosts) }, () => nacl.box.keyPair())
const spliceIdleTimeoutMs = values['splice-idle-timeout-ms']
const vars = {
  ...secrets,
  HOST_ALLOWLIST: enrolledHosts.map((host) => hostIdOf(host.publicKey)).join(','),
  TEST_PUSH_PROVIDER_ORIGIN: providersOrigin,
  PUSH_PROVIDER_ORIGIN_OVERRIDE: `${providersOrigin}${providerOverrideDecoy}`,
  ...(spliceIdleTimeoutMs ? { SPLICE_IDLE_TIMEOUT_MS: spliceIdleTimeoutMs } : {})
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

// With an explicit entrypoint wrangler resolves the config's relative aliases from the working directory.
process.chdir(RELAY_DIR)
const { unstable_startWorker } = loadWrangler()
const worker = await unstable_startWorker({
  config,
  // The production Worker has no provider redirect; only this test entrypoint reaches the fake.
  entrypoint: join(RELAY_DIR, 'test/seal-relay-test-entry.ts'),
  bindings: Object.fromEntries(
    Object.entries(vars).map(([name, value]) => [name, { type: 'plain_text', value }])
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

writeRelayState(stateDir, {
  relay: {
    origin,
    persistDir,
    pushLog,
    providerOverrideDecoy,
    ...(spliceIdleTimeoutMs ? { spliceIdleTimeoutMs: Number(spliceIdleTimeoutMs) } : {}),
    pid: process.pid
  },
  enrolledHosts,
  operatorSecrets: values['expose-operator-secrets'] ? secrets : null
})
console.log(
  `seal-relay (local) listening on ${origin}; ${enrolledHosts.length} enrolled hosts; state in ${stateDir}`
)

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

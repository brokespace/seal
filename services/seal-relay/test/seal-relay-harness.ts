import { generateKeyPairSync, webcrypto } from 'node:crypto'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import { createServer as createNetServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import { unstable_startWorker } from 'wrangler'

export type ProviderRequest = { path: string; headers: IncomingMessage['headers']; body: string }

/** Stands in for APNs, FCM and Google OAuth; the Worker routes provider calls here in tests. */
export async function startFakeProviders(): Promise<{
  origin: string
  requests: ProviderRequest[]
  respond: (handler: (request: ProviderRequest) => { status: number; body?: string }) => void
  close: () => Promise<void>
}> {
  const requests: ProviderRequest[] = []
  let handler = (_request: ProviderRequest): { status: number; body?: string } => ({ status: 200 })
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      const request = {
        path: req.url ?? '',
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf8')
      }
      requests.push(request)
      const reply = handler(request)
      res.writeHead(reply.status, { 'content-type': 'application/json' })
      res.end(reply.body ?? '')
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('fake provider did not bind')
  }
  return {
    origin: `http://127.0.0.1:${address.port}`,
    requests,
    respond: (next) => {
      handler = next
    },
    close: () => new Promise((resolve) => server.close(() => resolve()))
  }
}

export async function generateTestSecrets(): Promise<{
  secrets: Record<string, string>
  apnsPublicKey: webcrypto.CryptoKey
}> {
  const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify'
  ])
  const privateJwk = {
    ...(await webcrypto.subtle.exportKey('jwk', pair.privateKey)),
    kid: 'test',
    alg: 'ES256'
  }
  const publicJwk = {
    ...(await webcrypto.subtle.exportKey('jwk', pair.publicKey)),
    kid: 'test',
    alg: 'ES256'
  }
  const apns = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const fcm = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const apnsPublicKey = await webcrypto.subtle.importKey(
    'spki',
    apns.publicKey.export({ format: 'der', type: 'spki' }),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify']
  )
  return {
    apnsPublicKey,
    secrets: {
      RELAY_JWT_PRIVATE_JWK: JSON.stringify(privateJwk),
      RELAY_JWKS: JSON.stringify({ keys: [publicJwk] }),
      HOST_SESSION_SECRET: 'test-host-session-secret-0123456789abcdef',
      ADMIN_SIGNING_KEY: 'test-admin-signing-key-0123456789abcdef',
      APNS_TEAM_ID: 'TEAMID1234',
      APNS_KEY_ID: 'KEYID12345',
      APNS_PRIVATE_KEY: apns.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
      FCM_SERVICE_ACCOUNT_JSON: JSON.stringify({
        project_id: 'seal-test',
        client_email: 'push@seal-test.iam.gserviceaccount.com',
        private_key: fcm.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString()
      })
    }
  }
}

async function freePort(): Promise<number> {
  const server = createNetServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  if (!address || typeof address === 'string') {
    throw new Error('no free port')
  }
  return address.port
}

export async function startSealRelay(
  vars: Record<string, string>
): Promise<{ origin: string; dispose: () => Promise<void> }> {
  const port = await freePort()
  // Keep the request URL the Worker sees equal to what clients dial (wrangler would rewrite it to the route host).
  const worker = await unstable_startWorker({
    config: fileURLToPath(new URL('../wrangler.toml', import.meta.url)),
    bindings: Object.fromEntries(
      Object.entries(vars).map(([name, value]) => [name, { type: 'plain_text' as const, value }])
    ),
    dev: {
      server: { hostname: '127.0.0.1', port },
      origin: { hostname: `127.0.0.1:${port}`, secure: false },
      inspector: false,
      persist: false,
      logLevel: 'warn'
    }
  })
  await worker.ready
  const url = await worker.url
  return { origin: url.origin, dispose: () => worker.dispose() }
}

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

export async function waitFor(condition: () => boolean, timeoutMs = 8000): Promise<boolean> {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    if (condition()) {
      return true
    }
    await sleep(25)
  }
  return condition()
}

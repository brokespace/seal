// The phone's page bundle in a hidden window, served by the app's real bridge host over a paired phone socket.
import { execFile } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import { MOBILE_WEB_PAGE_ROUTES } from '../../../config/scripts/build/mobile-web-app/mobile-web-page-routes.mjs'
import { createBridgeHost, type BridgeHost } from '../../../mobile/src/mobile-web-shell/bridge-host'
import {
  BRIDGE_STORE_VERB,
  storeParamsSchema
} from '../../../mobile/src/mobile-web-shell/bridge/bridge-store-verb'
import { routeViewOf } from '../../../mobile/src/mobile-web-shell/page-route-policy'
import type { RpcClient } from '../../../mobile/src/transport/rpc/rpc-client-contract'
import { decodePairingOffer } from '../../../src/shared/remote-runtime/pairing/pairing'
import { pairMobileClient, type PairedMobileClient } from './paired-mobile-client'
import type { RuntimeDesktopPairingOffer } from './paired-electron-client'

const PHONE_HOST = {
  id: 'e2e-desktop',
  name: 'E2E desktop',
  endpoint: 'ws://e2e',
  lastConnected: 1
}
const POST_BINDING = '__phoneShellPost'
const VIEWPORT = { width: 390, height: 844 }

// The shipped page leaves Seal's hub to the native app; the same screens are bundled here to drive them.
const SEAL_HUB_GRANTS = ['navigate', 'storage', 'externalLink', 'haptics', 'native.clipboard.write']
const PHONE_PAGE_ROUTES = [
  ...MOBILE_WEB_PAGE_ROUTES,
  ...['', '/overview', '/sessions', '/sessions/[sessionId]'].map((route) => ({
    pathname: `/h/[hostId]/seal${route}`,
    grants: SEAL_HUB_GRANTS
  }))
]

export const PHONE_HOST_ROUTE = `/h/${PHONE_HOST.id}`

const BUNDLE_BUILDER = path.join(
  process.cwd(),
  'config/scripts/build/mobile-web-app/build-mobile-web-app-bundle.mjs'
)
const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2'
}

type ServedBundle = { origin: string; server: Server; dir: string }
let bundle: Promise<ServedBundle> | null = null

function servePhoneBundle(): Promise<ServedBundle> {
  bundle ??= (async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'seal-phone-page-'))
    // The builder is an ES module; Playwright loads this helper as CommonJS.
    await promisify(execFile)(process.execPath, [
      '--input-type=module',
      '-e',
      `const { buildMobileWebAppBundle } = await import(${JSON.stringify(pathToFileURL(BUNDLE_BUILDER).href)})
       await buildMobileWebAppBundle({ outDir: process.argv[1], nativeOnlyRouteDirs: new Set() })`,
      dir
    ])
    const server = createServer((request, response) => {
      const pathname = new URL(request.url ?? '/', 'http://localhost').pathname
      // Every route is the one document; only a path naming a file is an asset.
      const file = path.extname(pathname) ? pathname.slice(1) : 'index.html'
      readFile(path.join(dir, file)).then(
        (bytes) => {
          response.writeHead(200, {
            'content-type': CONTENT_TYPES[path.extname(file)] ?? 'application/octet-stream'
          })
          response.end(bytes)
        },
        () => {
          response.writeHead(404)
          response.end()
        }
      )
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: a server listening on TCP has an AddressInfo.
    const { port } = server.address() as AddressInfo
    return { origin: `http://127.0.0.1:${port}`, server, dir }
  })()
  return bundle
}

/** The phone's RPC client as the bridge host holds it, over the paired phone's own sockets. */
function phoneRpcClient(phone: PairedMobileClient): RpcClient {
  return {
    sendRequest: async (method, params, options) => {
      const response = await phone.request(method, params ?? {}, options?.timeoutMs)
      return response.ok
        ? { id: response.id, ok: true, result: response.result }
        : { id: response.id, ok: false, error: response.error }
    },
    subscribe: (method, params, onData) => {
      let close: (() => void) | null = null
      let closed = false
      void phone
        .subscribe(method, params, {
          onResponse: (response) => {
            if (!closed) {
              onData(response.ok ? response.result : { type: 'error', ...response.error })
            }
          },
          onError: (error) => {
            if (!closed) {
              onData({ type: 'error', message: error.message })
            }
          }
        })
        .then(
          (subscription) => {
            close = () => subscription.close()
            if (closed) {
              close()
            }
          },
          () => undefined
        )
      return () => {
        closed = true
        close?.()
      }
    },
    updateTerminalSubscriptionViewport: () => undefined,
    getState: () => 'connected',
    getReconnectAttempt: () => 0,
    getLastConnectedAt: () => 1,
    onStateChange: () => () => undefined,
    notifyForeground: () => undefined,
    close: () => undefined
  }
}

export type PhoneWebPage = {
  page: Page
  /** Opens a route as the app's shell does: a new document served for that screen. */
  open: (href: string) => Promise<void>
  /** Every route the page handed to the shell, in order; each one is opened as it arrives. */
  handoffs: string[]
  /** Faults the page's error boundary reported. */
  faults: string[]
  dispose: () => Promise<void>
}

/**
 * Pairs a phone with `offer` and shows its page at `href`. Requests and subscriptions reach the
 * host exactly as a phone's do; only the native shell around the page is stood in for.
 */
export async function openPhoneWebPage(
  app: ElectronApplication,
  offer: RuntimeDesktopPairingOffer,
  href: string
): Promise<PhoneWebPage> {
  const { origin } = await servePhoneBundle()
  const phone = pairMobileClient(offer)
  const client = phoneRpcClient(phone)
  const deviceToken = decodePairingOffer(offer.pairingUrl).deviceToken
  const handoffs: string[] = []
  const faults: string[] = []
  const storage: Record<string, string> = {}
  let host: BridgeHost | null = null
  let page: Page | null = null
  let delivery = Promise.resolve()
  let session = 0

  const serve = (target: string): BridgeHost => {
    const url = new URL(target, origin)
    const view = routeViewOf(PHONE_PAGE_ROUTES, url.pathname)
    session += 1
    return createBridgeHost({
      client,
      post: (json) => {
        delivery = delivery.then(async () => {
          await page
            ?.evaluate((frame) => {
              // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: installed by this helper's init script.
              ;(
                globalThis as unknown as { __phoneShellDeliver: (json: string) => void }
              ).__phoneShellDeliver(frame)
            }, json)
            .catch(() => undefined)
        })
        return delivery
      },
      buildId: 'e2e-phone-page',
      sessionId: `e2e-phone-session-${session}`,
      route: { pathname: url.pathname, params: Object.fromEntries(url.searchParams) },
      pageRoutes: view.pageRoutes,
      pageRouteGrants: view.pageRouteGrants,
      routeGrants: view.routeGrants,
      ownsHostArea: view.ownsHostArea,
      sessionEstablished: false,
      readClientIdentity: () => deviceToken,
      host: PHONE_HOST,
      readStorage: () => ({ storage, storageOversize: [] }),
      onStorageWrite: (key, value) => {
        if (value === null) {
          delete storage[key]
        } else {
          storage[key] = value
        }
      },
      onNavigate: (next) => {
        handoffs.push(next)
        void open(next)
      },
      // No device store here: the page takes its own "unavailable" answer as a cold cache.
      serveNativeVerb: (verb, params) =>
        verb === BRIDGE_STORE_VERB
          ? Promise.resolve(
              storeParamsSchema.parse(params).action === 'read'
                ? { refusal: 'unavailable' }
                : { written: false, refusal: 'unavailable' }
            )
          : Promise.reject(new Error(`${verb} needs a device`)),
      onExternalLink: () => undefined,
      onHaptic: () => undefined,
      onNavigateBack: () => 'nothing-to-pop',
      onPageFault: (error) => faults.push(error.message),
      onPageReady: () => undefined,
      onPagePainted: () => undefined,
      onPageBackClaim: () => undefined,
      onPageLocation: () => undefined,
      onRouteParamClear: () => undefined,
      onRouteRefused: (issue) => faults.push(`route refused: ${issue}`)
    })
  }

  const open = async (target: string): Promise<void> => {
    host?.dispose()
    host = serve(target)
    await page?.goto(`${origin}/`, { waitUntil: 'load' })
  }

  const context = app.context()
  await context.exposeBinding(POST_BINDING, (_source, json: string) => host?.receive(json))
  await context.addInitScript(
    ({ pageOrigin, binding }) => {
      if (location.origin !== pageOrigin) {
        return
      }
      const channel: { postMessage: (json: string) => void; onmessage: unknown } = {
        postMessage: (json) => {
          // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the binding this helper exposed.
          void (globalThis as unknown as Record<string, (json: string) => Promise<void>>)[binding](
            json
          )
        },
        onmessage: null
      }
      Object.assign(globalThis, {
        orcaBridge: channel,
        __phoneShellDeliver: (json: string) => {
          if (typeof channel.onmessage === 'function') {
            channel.onmessage({ data: json })
          }
        }
      })
    },
    { pageOrigin: origin, binding: POST_BINDING }
  )
  host = serve(href)
  const opened = app.waitForEvent('window')
  await app.evaluate(
    ({ BrowserWindow }, { url, size }) => {
      const window = new BrowserWindow({
        ...size,
        show: false,
        webPreferences: { backgroundThrottling: false }
      })
      void window.loadURL(url)
    },
    { url: `${origin}/`, size: VIEWPORT }
  )
  page = await opened
  await page.waitForFunction(() => document.documentElement.dataset.orcaWebEntry === 'mounted')

  return {
    page,
    open,
    handoffs,
    faults,
    dispose: async () => {
      host?.dispose()
      phone.dispose()
      await page?.close().catch(() => undefined)
    }
  }
}

/** Stops the bundle's server and removes its files; call once when the spec file is done. */
export async function closePhoneBundle(): Promise<void> {
  const served = await bundle?.catch(() => null)
  bundle = null
  served?.server.close()
  if (served) {
    rmSync(served.dir, { recursive: true, force: true })
  }
}

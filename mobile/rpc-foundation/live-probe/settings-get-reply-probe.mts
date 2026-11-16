// Runtime probe: real mock-desktop settings.get replies through the migrated acceptance layer.
import WebSocket from 'ws'
import nacl from 'tweetnacl'
import { readFileSync } from 'node:fs'
import { authenticatePairedE2EEV2TestClient } from '../../../src/main/runtime/rpc/mobile/e2ee/paired-e2ee-v2-test-client.ts'
import { botOverridesRead } from '../../src/source-control/review/pull-request/comments/mobile-pr-bot-settings-operations.ts'
import { newTabSettingsRead } from '../../src/session/agent-launch/mobile-new-tab-settings-operations.ts'
import {
  optionalSettingsRead,
  settingsRead
} from '../../src/settings/mobile-settings-read-operations.ts'

const PORT = Number(process.env.PORT) || 6768
const KEY_FILE = process.env.MOCK_SERVER_KEY_FILE!
const serverPublic = nacl.box.keyPair.fromSecretKey(
  Uint8Array.from(Buffer.from(readFileSync(KEY_FILE, 'utf-8').trim(), 'base64'))
).publicKey

function rawReply(): Promise<unknown> {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}`)
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (value: unknown) => {
      if (!settled) {
        settled = true
        try {
          ws.close()
        } catch {}
        resolve(value)
      }
    }
    const timer = setTimeout(() => finish({ __outcome: 'no-reply-timeout' }), 5000)
    ws.on('open', () => {
      void authenticatePairedE2EEV2TestClient(ws, {
        hostPublicKeyB64: Buffer.from(serverPublic).toString('base64'),
        deviceToken: 'mock-device-token'
      }).then(
        (channel) => {
          channel.onText((plain) => {
            // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the probe prints whatever the host sent, so the frame is read as a bag of fields.
            const frame = JSON.parse(plain) as { id?: string }
            if (frame.id === 'probe-1') {
              clearTimeout(timer)
              finish(frame)
            }
          })
          channel.sendText(
            JSON.stringify({ id: 'probe-1', method: 'settings.get', token: 'mock-device-token' })
          )
        },
        () => {
          clearTimeout(timer)
          finish({ __outcome: 'socket-closed-before-reply' })
        }
      )
    })
    ws.on('close', () => {
      clearTimeout(timer)
      finish({ __outcome: 'socket-closed-before-reply' })
    })
    ws.on('error', (e) => {
      clearTimeout(timer)
      if (!settled) {
        settled = true
        reject(e)
      }
    })
  })
}

function describe(label: string, run: () => unknown): string {
  try {
    const value = run()
    return `${label}=${JSON.stringify(value)}`
  } catch (error) {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: a thrown value is not an Error by type; only its constructor name and message are printed.
    return `${label}=THREW ${(error as Error).constructor.name}: ${(error as Error).message}`
  }
}

// oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the probe substitutes one recorded reply for the whole client surface.
const reply = (await rawReply()) as Record<string, unknown>
// oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the probe substitutes one recorded reply for the whole client surface.
const client = {
  sendRequest: async () => reply
} as unknown as Parameters<typeof settingsRead.request>[0]

const lines: string[] = [`mode=${process.env.MOCK_SETTINGS_GET_MODE ?? 'ok'}`]
lines.push(`wireReply=${JSON.stringify(reply)}`)
if (reply.__outcome) {
  lines.push('interpret=skipped (no reply frame)')
} else {
  for (const [name, op] of [
    ['settingsRead', settingsRead],
    ['optionalSettingsRead', optionalSettingsRead],
    ['botOverridesRead', botOverridesRead],
    ['newTabSettingsRead', newTabSettingsRead]
  ] as const) {
    const response = await op.request(client)
    lines.push(
      describe(name, () => {
        // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: each operation is driven through its own declared reply type in turn.
        const outcome = op.interpret(response as never) as
          | (() => unknown)
          | { accepted?: boolean; value?: unknown }
        // new-tab acceptance returns a deferred reader, not an accept envelope.
        if (typeof outcome === 'function') {
          return { deferred: outcome() }
        }
        const value = typeof outcome?.value === 'function' ? outcome.value() : outcome?.value
        return outcome?.accepted === undefined ? value : { accepted: outcome.accepted, value }
      })
    )
  }
}
process.stdout.write(lines.join('\n') + '\n')

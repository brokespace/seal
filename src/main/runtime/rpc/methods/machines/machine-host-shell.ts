import type { MachineShell } from '../../../../machines/connection/machine-connection'
import { openShellOnThisMachine } from '../../../../machines/connection/local-machine-shell'
import { nextSubscriptionId, type Emit, type StreamContext } from './machine-host-streams'

const shells = new Map<string, MachineShell>()

type ShellParams = { cols: number; rows: number; cwd?: string; command?: string }

export async function runMachineHostShell(
  params: ShellParams,
  ctx: StreamContext,
  emit: Emit
): Promise<void> {
  const subscriptionId = nextSubscriptionId('shell', ctx.connectionId)
  await new Promise<void>((resolve, reject) => {
    let ended = false
    let shell: MachineShell | null = null
    const end = (): void => {
      if (ended) {
        return
      }
      ended = true
      shells.delete(subscriptionId)
      ctx.signal?.removeEventListener('abort', onAbort)
      shell?.close()
      emit({ type: 'end' })
      resolve()
    }
    function onAbort(): void {
      ctx.runtime.cleanupSubscription(subscriptionId)
    }
    openShellOnThisMachine(params, {
      onData: (data) => emit({ type: 'data', dataBase64: Buffer.from(data).toString('base64') }),
      onExit: (exitCode) => {
        emit({ type: 'exit', exitCode })
        ctx.runtime.cleanupSubscription(subscriptionId)
      }
    }).then(
      (opened) => {
        if (ended) {
          opened.close()
          return
        }
        shell = opened
        shells.set(subscriptionId, opened)
        ctx.runtime.registerSubscriptionCleanup(subscriptionId, end, ctx.connectionId)
        ctx.signal?.addEventListener('abort', onAbort, { once: true })
        emit({ type: 'starting', subscriptionId })
        if (ctx.signal?.aborted) {
          onAbort()
        }
      },
      (error: unknown) => reject(error)
    )
  })
}

function requireShell(subscriptionId: string): MachineShell {
  const shell = shells.get(subscriptionId)
  if (!shell) {
    throw new Error('That terminal has ended')
  }
  return shell
}

export function writeMachineHostShell(subscriptionId: string, dataBase64: string): { ok: true } {
  requireShell(subscriptionId).write(Buffer.from(dataBase64, 'base64').toString('utf8'))
  return { ok: true }
}

export function resizeMachineHostShell(
  subscriptionId: string,
  cols: number,
  rows: number
): { ok: true } {
  requireShell(subscriptionId).resize(cols, rows)
  return { ok: true }
}

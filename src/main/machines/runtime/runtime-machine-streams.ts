import type { RuntimeMachineChannel } from './runtime-machine-channel'

const STREAM_START_TIMEOUT_MS = 15_000
const CANCEL_TIMEOUT_MS = 5_000

function cancelStream(channel: RuntimeMachineChannel, subscriptionId: string | null): void {
  if (subscriptionId) {
    void channel.call('machineHost.cancel', { subscriptionId }, CANCEL_TIMEOUT_MS).catch(() => {})
  }
}

/** Resolves once the runtime's watcher is live, so a refused watch can fall back to polling. */
export async function startRuntimeMachineWatch(
  channel: RuntimeMachineChannel,
  dirs: string[],
  onChange: (dir: string) => void
): Promise<() => void> {
  let subscriptionId: string | null = null
  let settleStart: (error?: Error) => void = () => {}
  const started = new Promise<void>((resolve, reject) => {
    settleStart = (error) => (error ? reject(error) : resolve())
  })
  const handle = await channel.stream(
    'machineHost.watch',
    { dirs },
    {
      onEvent: (event) => {
        if (event.type === 'starting') {
          subscriptionId = event.subscriptionId
          settleStart()
        } else if (event.type === 'change') {
          onChange(event.dir)
        }
      },
      onError: (message) => settleStart(new Error(message)),
      onClose: () => settleStart(new Error('Runtime closed the folder watch'))
    }
  )
  const timer = setTimeout(
    () => settleStart(new Error('Runtime did not start the folder watch')),
    STREAM_START_TIMEOUT_MS
  )
  try {
    await started
  } catch (error) {
    handle.close()
    throw error
  } finally {
    clearTimeout(timer)
  }
  let stopped = false
  return () => {
    if (stopped) {
      return
    }
    stopped = true
    handle.close()
    cancelStream(channel, subscriptionId)
  }
}

/** The runtime host fetches the URL itself; only progress events cross the socket. */
export async function runRuntimeMachineUrlDownload(
  channel: RuntimeMachineChannel,
  url: string,
  destination: string,
  onProgress: (transferred: number, total: number | null) => void,
  signal: AbortSignal
): Promise<void> {
  signal.throwIfAborted()
  let subscriptionId: string | null = null
  let settle: (error?: Error) => void = () => {}
  const finished = new Promise<void>((resolve, reject) => {
    settle = (error) => (error ? reject(error) : resolve())
  })
  const handle = await channel.stream(
    'machineHost.downloadUrl',
    { url, destination },
    {
      onEvent: (event) => {
        switch (event.type) {
          case 'starting':
            subscriptionId = event.subscriptionId
            if (signal.aborted) {
              cancelStream(channel, subscriptionId)
            }
            break
          case 'progress':
            onProgress(event.transferred, event.total)
            break
          case 'done':
            onProgress(event.transferred, event.total ?? event.transferred)
            settle()
            break
          case 'cancelled':
            settle(new Error('Download cancelled'))
            break
          case 'error':
            settle(new Error(event.message))
            break
          case 'change':
          case 'end':
          case 'data':
          case 'exit':
            break
        }
      },
      onError: (message) => settle(new Error(message)),
      onClose: () => settle(new Error('Runtime connection closed during the download'))
    }
  )
  const onAbort = (): void => {
    cancelStream(channel, subscriptionId)
    settle(new Error('Download cancelled'))
  }
  signal.addEventListener('abort', onAbort, { once: true })
  if (signal.aborted) {
    onAbort()
  }
  try {
    await finished
  } finally {
    signal.removeEventListener('abort', onAbort)
    handle.close()
  }
}

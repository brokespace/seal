import { readIpcErrorDetail } from '@/runtime/errors/ipc-error'

/** False in the browser client, which has no connection to machines of its own. */
export function agentConfigAvailable(): boolean {
  return typeof window !== 'undefined' && Boolean(window.api?.agentConfig)
}

export function agentConfigApi(): NonNullable<typeof window.api.agentConfig> {
  const api = window.api.agentConfig
  if (!api) {
    throw new Error('Agent configuration needs the desktop app')
  }
  return api
}

export function agentConfigErrorText(error: unknown): string {
  return readIpcErrorDetail(error) ?? String(error)
}

import { readIpcErrorDetail } from '@/runtime/errors/ipc-error'

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

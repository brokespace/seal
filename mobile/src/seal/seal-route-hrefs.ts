export type SealPage = 'overview' | 'machines' | 'accounts' | 'sessions' | 'chat'

export function sealHubHref(hostId: string): `/h/${string}` {
  return `/h/${encodeURIComponent(hostId)}/seal`
}

export function sealPageHref(hostId: string, page: SealPage): `/h/${string}` {
  return `${sealHubHref(hostId)}/${page}`
}

export function sealSessionHref(hostId: string, sessionId: string): `/h/${string}` {
  return `${sealPageHref(hostId, 'sessions')}/${encodeURIComponent(sessionId)}`
}

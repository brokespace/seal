// SpliceRelay's stored per-connection state and per-socket attachment shapes.
export type State = {
  connId: string
  relayHostId: string
  // A phone that has not been authorized has no stored state: see GuardAttachment.authDeadline.
  phase: 'pending' | 'spliced'
  deadline: number
  connTicket?: string
  generation?: number
}
export type SocketKind = 'phone' | 'data'
// Per-direction flood guard: bytes forwarded to a peer since that peer last sent anything.
// place: client ingress '<continent>/<colo>', for metrics.
// sentBytes/sentFrames: what this socket sent, kept on the attachment so it survives hibernation.
// authDeadline: set on a phone socket until its credential frame arrives, so an anonymous connect
// writes nothing durable. lastFrameAt: when this socket last sent a frame into the splice.
export type GuardAttachment = {
  silentBytes: number
  windowStart: number
  place?: string
  sentBytes?: number
  sentFrames?: number
  authDeadline?: number
  lastFrameAt?: number
}

export const NO_DEADLINE = Number.MAX_SAFE_INTEGER
export const KEY_PREFIX = 'splice:'

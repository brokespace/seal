import { RelayRetrySchedule } from '../authentication/relay-retry-schedule'
import type { RelayRevokeOutbox } from './relay-revoke-outbox'

export type RelayRevokeSender = {
  readonly hostId: string
  readonly ownerIdentityKey: string
  revokeDevice(relayDeviceId: string, reqId?: string): Promise<void>
}

type RelayRevokeDeliveryOptions = {
  outbox: RelayRevokeOutbox
  activeSender: () => RelayRevokeSender | null
  onDelivered: () => void
  retry?: RelayRetrySchedule
}

const MIN_RETRY_DELAY_MS = 1_000

/**
 * Sends queued `device-revoke`s until the relay confirms each one: a revoked device keeps its
 * relay credential for as long as its revoke sits in the outbox, so a failed send is retried with
 * backoff rather than left for the next reconnect.
 */
export class RelayRevokeDelivery {
  private readonly retry: RelayRetrySchedule
  private flushing = false
  private flushRequested: { sender: RelayRevokeSender | null } | null = null
  private stopped = false

  constructor(private readonly options: RelayRevokeDeliveryOptions) {
    this.retry = options.retry ?? new RelayRetrySchedule()
  }

  /** Call when a revoke is queued or the relay registers; `sender` names a broker not yet active. */
  flush(sender: RelayRevokeSender | null = this.options.activeSender()): void {
    if (this.stopped) {
      return
    }
    if (this.flushing) {
      this.flushRequested = { sender }
      return
    }
    this.flushing = true
    void this.run(sender).finally(() => {
      this.flushing = false
      const requested = this.flushRequested
      this.flushRequested = null
      if (requested) {
        this.flush(requested.sender)
      }
    })
  }

  stop(): void {
    this.stopped = true
    this.retry.cancel()
  }

  private async run(sender: RelayRevokeSender | null): Promise<void> {
    if (!sender) {
      // Nothing to send through; registering again flushes.
      return
    }
    this.retry.cancel()
    let failed = false
    for (const item of this.options.outbox.pendingFor(sender.ownerIdentityKey, sender.hostId)) {
      if (this.stopped) {
        return
      }
      try {
        await sender.revokeDevice(item.relayDeviceId, item.reqId)
        this.options.outbox.remove(item.reqId)
        this.options.onDelivered()
      } catch {
        // The item and its reqId stay queued, so the retry is idempotent at the relay.
        failed = true
      }
    }
    if (!failed) {
      this.retry.reset()
    } else if (!this.stopped) {
      this.retry.schedule(MIN_RETRY_DELAY_MS, () => this.flush())
    }
  }
}

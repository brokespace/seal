type PendingApproval = { chatId: string; resolve: (approved: boolean) => void }

/** Holds tool calls that wait on an in-chat approval card. */
export class HomeChatApprovals {
  private readonly pending = new Map<string, PendingApproval>()

  constructor(private readonly onRequest: (chatId: string) => void = () => {}) {}

  request(chatId: string, entryId: string, signal?: AbortSignal): Promise<boolean> {
    if (signal?.aborted) {
      return Promise.resolve(false)
    }
    this.onRequest(chatId)
    return new Promise<boolean>((resolve) => {
      const settle = (approved: boolean): void => {
        signal?.removeEventListener('abort', onAbort)
        this.pending.delete(entryId)
        resolve(approved)
      }
      const onAbort = (): void => settle(false)
      signal?.addEventListener('abort', onAbort, { once: true })
      this.pending.set(entryId, { chatId, resolve: settle })
    })
  }

  /** False when nothing waits on this entry, e.g. after a stop already declined it. */
  respond(chatId: string, entryId: string, approved: boolean): boolean {
    const waiting = this.pending.get(entryId)
    if (!waiting || waiting.chatId !== chatId) {
      return false
    }
    waiting.resolve(approved)
    return true
  }

  declineAll(chatId: string): void {
    for (const waiting of this.pending.values()) {
      if (waiting.chatId === chatId) {
        waiting.resolve(false)
      }
    }
  }
}

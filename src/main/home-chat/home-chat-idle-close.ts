/** One pending close per chat: armed when a turn ends, cancelled when the next one starts. */
export class HomeChatIdleClose {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()

  arm(chatId: string, ms: number, close: () => void): void {
    this.clear(chatId)
    const timer = setTimeout(() => {
      this.timers.delete(chatId)
      close()
    }, ms)
    timer.unref?.()
    this.timers.set(chatId, timer)
  }

  clear(chatId: string): void {
    clearTimeout(this.timers.get(chatId))
    this.timers.delete(chatId)
  }
}

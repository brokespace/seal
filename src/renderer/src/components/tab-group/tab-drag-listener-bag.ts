type ListenerEntry = {
  eventName: string
  handler: EventListener
  options?: AddEventListenerOptions | boolean
  target: EventTarget
}

/** Event listeners of one drag gesture, removed together. */
export class ListenerBag {
  private readonly listeners: ListenerEntry[] = []

  add<T extends Event>(
    target: EventTarget | null,
    eventName: string,
    handler: (event: T) => void,
    options?: AddEventListenerOptions | boolean
  ): void {
    if (!target) {
      return
    }
    const listener = handler as EventListener
    target.addEventListener(eventName, listener, options)
    this.listeners.push({ eventName, handler: listener, options, target })
  }

  removeAll = (): void => {
    for (const { eventName, handler, options, target } of this.listeners) {
      target.removeEventListener(eventName, handler, options)
    }
    this.listeners.length = 0
  }
}

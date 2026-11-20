import type { WebSocket } from 'ws'
import type { WsOutboundBackpressureQueue } from '../../../../../shared/ws-outbound-backpressure-queue'
import {
  createDesktopMobileE2EEV2OutboundQueue,
  desktopMobileE2EEV2OutboundItemBytes,
  type DesktopMobileE2EEV2OutboundItem
} from './mobile-e2ee-v2-desktop-outbound'
import type { DesktopMobileE2EEV2Session } from './mobile-e2ee-v2-desktop-session'
import {
  createMobileE2EEOutboundMemoryBudget,
  type MobileE2EEOutboundMemoryBudget,
  type MobileE2EEOutboundSocketMemory
} from './mobile-e2ee-outbound-memory-budget'
import type { RpcBinarySendOptions } from '../../transports/rpc-binary-sender'
import type { RuntimeClientCapabilities } from '../../callers/runtime-client-capabilities'
import { compressMobileE2EEV2Item } from './mobile-e2ee-v2-compressed-frame'

export class MobileE2EEDesktopOutboundOwner {
  private readonly memoryBudget: MobileE2EEOutboundMemoryBudget
  private readonly socketMemory: MobileE2EEOutboundSocketMemory | null
  // Why: one queue for text and binary, so a binary frame can neither overtake parked text nor drop silently.
  private v2Queue: WsOutboundBackpressureQueue<DesktopMobileE2EEV2OutboundItem> | null = null

  constructor(
    private readonly ws: WebSocket,
    private readonly onOverflow: () => void,
    private readonly clientCapabilities: RuntimeClientCapabilities,
    memoryBudget: MobileE2EEOutboundMemoryBudget = createMobileE2EEOutboundMemoryBudget()
  ) {
    this.memoryBudget = memoryBudget
    this.socketMemory = memoryBudget.registerBufferedAmount(() => ws.bufferedAmount)
  }

  enqueueV2(
    plain: DesktopMobileE2EEV2OutboundItem,
    session: DesktopMobileE2EEV2Session,
    options?: RpcBinarySendOptions
  ): boolean | 'backlogged' {
    const item = compressMobileE2EEV2Item(plain, this.clientCapabilities.current, options)
    if (!this.socketMemory) {
      this.onOverflow()
      return false
    }
    this.v2Queue ??= createDesktopMobileE2EEV2OutboundQueue({
      ws: this.ws,
      session,
      memoryBudget: this.memoryBudget,
      socketMemory: this.socketMemory,
      onOverflow: this.onOverflow
    })
    if (
      options?.dropWhenBacklogged &&
      !this.v2Queue.isIdle(desktopMobileE2EEV2OutboundItemBytes(item))
    ) {
      return 'backlogged'
    }
    return this.v2Queue.enqueue(item)
  }

  dispose(): void {
    this.v2Queue?.dispose()
    this.v2Queue = null
    this.socketMemory?.release()
  }
}

import { createContext } from 'react'
import type { NativeChatMessage } from '../../../../../src/shared/native-chat/native-chat-types'
import type { MobileNativeChatRowImageSource } from '../visual/mobile-native-chat-image-preview'

export type MobileNativeChatViewedImage = { uri: string; label: string }

// Keep overlays above replaceable rows so echo/transcript swaps cannot close a selected image or actions sheet.
export type MobileNativeChatRowOverlays = {
  openImage: (image: MobileNativeChatViewedImage) => void
  openActions: (message: NativeChatMessage) => void
  /** Confirms, then rewinds the chat to this user message; explains instead when it can't now. */
  openRewind: (itemId: string) => void
  /** Reads the images the phone cannot load itself: host paths, or URLs only the host can read. */
  imageSource?: MobileNativeChatRowImageSource
}

export const MobileNativeChatRowOverlaysContext = createContext<MobileNativeChatRowOverlays>({
  openImage: () => {},
  openActions: () => {},
  openRewind: () => {}
})

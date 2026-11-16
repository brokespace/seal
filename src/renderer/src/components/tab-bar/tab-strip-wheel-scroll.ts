/** A vertical wheel over a tab strip scrolls it sideways. Returns the unsubscribe. */
export function scrollTabStripOnWheel(strip: HTMLElement, onScrolled?: () => void): () => void {
  const onWheel = (event: WheelEvent): void => {
    if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
      event.preventDefault()
      strip.scrollLeft += event.deltaY
      onScrolled?.()
    }
  }
  strip.addEventListener('wheel', onWheel, { passive: false })
  return () => strip.removeEventListener('wheel', onWheel)
}

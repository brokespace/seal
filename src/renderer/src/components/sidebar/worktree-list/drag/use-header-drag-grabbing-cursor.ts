import { useEffect } from 'react'

/** Shows the grabbing cursor and stops text selection for as long as a header is being dragged. */
export function useHeaderDragGrabbingCursor(dragging: boolean): void {
  useEffect(() => {
    if (!dragging) {
      return
    }
    const body = document.body
    const { cursor: prevCursor, userSelect: prevUserSelect } = body.style
    body.style.cursor = 'grabbing'
    body.style.userSelect = 'none'
    return () => {
      body.style.cursor = prevCursor
      body.style.userSelect = prevUserSelect
    }
  }, [dragging])
}

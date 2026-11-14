/** Prevent the post-drag click from toggling the reordered section; time out if no click arrives. */
export function swallowNextClickOnDragHandle(handleEl: HTMLElement): void {
  const swallow = (event: MouseEvent): void => {
    const target = event.target as Node | null
    if (target && handleEl.contains(target)) {
      event.stopPropagation()
      event.preventDefault()
    }
    window.removeEventListener('click', swallow, true)
  }
  window.addEventListener('click', swallow, true)
  // Why: never cancelled, so a drop that yields no click cannot leave this eating the next real one.
  setTimeout(() => window.removeEventListener('click', swallow, true), 0)
}

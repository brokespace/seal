/** A react-native-web DOM node. RN's native runtime also defines `HTMLElement` (for its host views,
 *  which lack DOM methods like `addEventListener`), so only a `document` proves a DOM. */
export function isWebDomElement(node: unknown): node is HTMLElement {
  return (
    typeof document !== 'undefined' &&
    typeof HTMLElement !== 'undefined' &&
    node instanceof HTMLElement
  )
}

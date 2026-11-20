import {
  RECAP_SECTIONS,
  type SessionRecap,
  type SessionRecapView
} from '../../../../../shared/session-recap/session-recap-types'

function plain<T extends { messageId: string | null }>(items: readonly T[]): T[] {
  return items.map((item) => (item.messageId === null ? item : { ...item, messageId: null }))
}

/** The recap for a chat view that cannot scroll to a message: an item with no message is plain text. */
export function recapViewWithoutMessageJumps(view: SessionRecapView): SessionRecapView {
  if (!view.recap) {
    return view
  }
  const { requests } = view.recap
  const recap: SessionRecap = {
    ...view.recap,
    references: plain(view.recap.references),
    ...(requests ? { requests: plain(requests) } : {})
  }
  for (const section of RECAP_SECTIONS) {
    recap[section] = plain(view.recap[section])
  }
  return { ...view, recap }
}

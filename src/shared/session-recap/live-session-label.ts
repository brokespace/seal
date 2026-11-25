type Labelled = {
  /** The name the user gave it in Seal. */
  customTitle?: string | null
  /** The provider's title: its own summary, else the first prompt. */
  title: string | null
  /** That title is a name the user gave it in the agent itself. */
  titleNamed?: boolean
  recap?: { title: string | null }
  project: string | null
}

/**
 * What a session is called. A name the user set, in Seal or in the agent, always wins; the recap's
 * rolling title only replaces the provider's own (its first prompt), never a name.
 */
export function liveSessionLabel(session: Labelled): string | null {
  return (
    session.customTitle ||
    (session.titleNamed ? session.title : null) ||
    session.recap?.title ||
    session.title ||
    session.project ||
    null
  )
}

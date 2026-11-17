import { useMemo } from 'react'
import { useIsSessionOnView } from '@/components/live-sessions/open/use-agent-session-showing'
import { withKeyboardPreview } from '../navigation/use-keyboard'

type Preview = Parameters<typeof withKeyboardPreview>[1]

/** The props as the rows read them, and whether the active workspace's card is what the list marks. */
export function useActiveCardMark<P extends Parameters<typeof withKeyboardPreview>[0]>(
  props: P,
  keyboardPreview: Preview
): { rowProps: P; marksActiveCard: boolean } {
  const sessionOnView = useIsSessionOnView()
  const rowProps = useMemo(
    () => withKeyboardPreview(props, keyboardPreview),
    [keyboardPreview, props]
  )
  // A session on view is marked by its own row; a held arrow still previews the card it lands on.
  return { rowProps, marksActiveCard: keyboardPreview !== null || !sessionOnView }
}

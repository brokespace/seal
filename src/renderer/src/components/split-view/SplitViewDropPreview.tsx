import { useTranslate } from '@/i18n/use-translate'
import TabGroupDropOverlay from '../tab-group/TabGroupDropOverlay'
import {
  useSplitViewDropPreview,
  type SplitViewDropPreview as Preview
} from './split-view-drop-target'

function useDropLabel(kind: Preview['kind']): string | undefined {
  const t = useTranslate()
  switch (kind) {
    case 'left':
      return t('seal.splitView.drop.left', 'Split left')
    case 'right':
      return t('seal.splitView.drop.right', 'Split right')
    case 'up':
      return t('seal.splitView.drop.up', 'Split up')
    case 'down':
      return t('seal.splitView.drop.down', 'Split down')
    case 'center':
      return t('seal.splitView.drop.tab', 'Add as tab')
    case 'open':
      return t('seal.splitView.drop.open', 'Open')
    case 'insert':
      return undefined
  }
}

/** Where a dragged row or tab would land. Mounted once; any pointer drag drives it. */
export function SplitViewDropPreview(): React.JSX.Element | null {
  const preview = useSplitViewDropPreview()
  const label = useDropLabel(preview?.kind ?? 'insert')
  if (!preview) {
    return null
  }
  const { rect } = preview
  return (
    <div
      aria-hidden="true"
      data-split-view-drop-preview={preview.kind}
      className="pointer-events-none fixed z-[9999]"
      style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
    >
      {preview.kind === 'insert' ? (
        <div className="absolute inset-0 bg-blue-500" />
      ) : (
        <TabGroupDropOverlay zone="center" fillContainer label={label} />
      )}
    </div>
  )
}

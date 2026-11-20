import { useTranslate } from '@/i18n/use-translate'
import { getDropIndicatorClasses } from '../tab-bar/drop-indicator'
import TabGroupDropOverlay from '../tab-group/TabGroupDropOverlay'
import {
  useSplitViewDropPreview,
  type SplitViewDropPreview as Preview
} from './split-view-drag-state'

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

/**
 * The pane or half a dragged row or tab would land in. A strip draws an insertion on its own tabs;
 * the bar is drawn here once more, over it, because a sidebar row's ghost hangs by the pointer and
 * covers the tab's own.
 */
export function SplitViewDropPreview(): React.JSX.Element | null {
  const preview = useSplitViewDropPreview()
  const label = useDropLabel(preview?.kind ?? 'insert')
  if (!preview) {
    return null
  }
  const { rect } = preview
  if (preview.kind === 'insert') {
    // The drag ghost is at z-index 2147483000.
    return preview.insertion && rect.width > 0 ? (
      <div
        aria-hidden="true"
        data-split-view-insertion-bar=""
        className={`pointer-events-none fixed z-[2147483001] ${getDropIndicatorClasses('left')}`}
        style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
      />
    ) : null
  }
  return (
    <div
      aria-hidden="true"
      data-split-view-drop-preview={preview.kind}
      className="pointer-events-none fixed z-[9999]"
      style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
    >
      <TabGroupDropOverlay zone="center" fillContainer label={label} />
    </div>
  )
}

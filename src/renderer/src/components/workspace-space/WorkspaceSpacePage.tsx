import { ArrowLeft } from 'lucide-react'
import { Button } from '../ui/button'
import { WorkspaceSpaceManagerPanel } from '../status-bar/WorkspaceSpaceManagerPanel'
import { useAppStore } from '../../store'
import { useTranslate } from '@/i18n/use-translate'
import { cn } from '@/lib/class-names'
import {
  PAGE_GUTTER_X,
  PageHeader,
  PageLayout,
  PagePanes,
  PageTitle
} from '@/components/page-layout/PageLayout'

export default function WorkspaceSpacePage(): React.JSX.Element {
  const t = useTranslate()
  const closeSpacePage = useAppStore((state) => state.closeSpacePage)
  const isSeparateWindow = window.location.pathname.endsWith('/space.html')

  return (
    <PageLayout className="overflow-hidden">
      <PageHeader
        title={
          <>
            {!isSeparateWindow ? (
              <Button variant="ghost" size="xs" onClick={closeSpacePage}>
                <ArrowLeft className="size-3.5" />
                {t('auto.components.workspace.space.WorkspaceSpacePage.ecf72fdc3b', 'Back')}
              </Button>
            ) : null}
            <PageTitle>
              {t('auto.components.status.bar.WorkspaceSpaceCompactPanel.8ff597593d', 'Space')}
            </PageTitle>
          </>
        }
      />
      <PagePanes className={cn('flex-col py-(--page-gutter)', PAGE_GUTTER_X)}>
        <WorkspaceSpaceManagerPanel />
      </PagePanes>
    </PageLayout>
  )
}

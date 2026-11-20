import type { TaskPageComposerActionsModel } from './use-task-page-composer-actions'
import { TaskPageListChrome } from './ListChrome'
import { TaskPageContent } from './Content'
import { cn } from '@/lib/class-names'
import { useTranslate } from '@/i18n/use-translate'
import { PAGE_GUTTER_X, PageHeader, PagePanes } from '@/components/page-layout/PageLayout'
export function TaskPageFrame({
  model
}: {
  model: TaskPageComposerActionsModel
}): React.JSX.Element | null {
  const t = useTranslate()
  return (
    <>
      <PageHeader title={t('auto.components.sidebar.SidebarNav.fee535205b', 'Tasks')} />
      <PagePanes className={cn('relative min-w-0 flex-col py-(--page-gutter)', PAGE_GUTTER_X)}>
        <TaskPageListChrome model={model} />

        <TaskPageContent model={model} />
      </PagePanes>
    </>
  )
}

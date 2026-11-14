import type { TaskPageComposerActionsModel } from './use-task-page-composer-actions'
import { TaskPageFrame } from './Frame'
import { TaskPageGitHubIssueDialog } from './github/issue-creation/IssueDialog'
import { TaskPageLinearProjectDialog } from './linear/creation/ProjectDialog'
import { TaskPageLinearIssueDialog } from './linear/creation/IssueDialog'
import { TaskPageJiraIssueDialog } from './jira/creation/IssueDialog'
import { TaskPageGitLabDialog } from './gitlab/Dialog'
import { TaskPageLinearConnectDialog } from './linear/ConnectDialog'
import { TaskPageJiraConnectDialog } from './jira/ConnectDialog'
import { PageLayout } from '@/components/page-layout/PageLayout'
export function TaskPageSurface({
  model
}: {
  model: TaskPageComposerActionsModel
}): React.JSX.Element {
  return (
    <PageLayout className="overflow-hidden">
      <TaskPageFrame model={model} />

      <TaskPageGitHubIssueDialog model={model} />

      <TaskPageLinearProjectDialog model={model} />

      <TaskPageLinearIssueDialog model={model} />

      <TaskPageJiraIssueDialog model={model} />

      <TaskPageGitLabDialog model={model} />

      <TaskPageLinearConnectDialog model={model} />

      <TaskPageJiraConnectDialog model={model} />
    </PageLayout>
  )
}

import type { Automation } from '../../../../shared/automations/automation-definition'
import type { DashboardWorkspace } from '../../../../shared/dashboard-snapshot'
import type { HomeAutomation, HomeWorkspace } from './home-overview-model'

export function orcaHomeWorkspaces(workspaces: readonly DashboardWorkspace[]): HomeWorkspace[] {
  return workspaces.map((workspace) => ({
    id: workspace.worktreeId,
    projectName: workspace.repoName,
    name: workspace.worktreeName,
    machineId: workspace.executionHostId,
    isFolder: workspace.workspaceKind === 'folder',
    ...(workspace.review
      ? { review: { number: workspace.review.number, state: workspace.review.state } }
      : {})
  }))
}

export function orcaHomeAutomations(automations: readonly Automation[]): HomeAutomation[] {
  return automations
    .map((automation) => ({
      id: automation.id,
      name: automation.name,
      enabled: automation.enabled,
      nextRunAt: automation.enabled && automation.nextRunAt > 0 ? automation.nextRunAt : null,
      lastRunAt: automation.lastRunAt ?? null
    }))
    .sort((a, b) => {
      if (a.enabled !== b.enabled) {
        return a.enabled ? -1 : 1
      }
      return (a.nextRunAt ?? Infinity) - (b.nextRunAt ?? Infinity)
    })
}

export type HomeWorkspaceCounts = {
  workspaces: number
  openReviews: number
  draftReviews: number
  mergedReviews: number
}

export function countHomeWorkspaces(workspaces: readonly HomeWorkspace[]): HomeWorkspaceCounts {
  const counts: HomeWorkspaceCounts = {
    workspaces: workspaces.length,
    openReviews: 0,
    draftReviews: 0,
    mergedReviews: 0
  }
  for (const workspace of workspaces) {
    if (workspace.review?.state === 'open') {
      counts.openReviews += 1
    } else if (workspace.review?.state === 'draft') {
      counts.draftReviews += 1
    } else if (workspace.review?.state === 'merged') {
      counts.mergedReviews += 1
    }
  }
  return counts
}

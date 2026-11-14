import React from 'react'
import { useTranslate } from '@/i18n/use-translate'
import { PageHeader } from '@/components/page-layout/PageLayout'
import { AutomationOwnerConflictNotice } from './hosts/AutomationOwnerConflictNotice'
import { AutomationsPageBreadcrumb } from './AutomationsPageBreadcrumb'
import type { AutomationHostRecoveryAction } from './hosts/automation-host-status-descriptors'
import type { AutomationActionNotice } from './hosts/automation-row-action-dispatch'

export function AutomationsPageTopBar({
  pageView,
  isDetailOpen,
  selectedAutomationName,
  runPageOrigin,
  ownerNotice,
  recoverOwnerAction,
  dismissOwnerAction,
  showAutomationsList,
  showRunsDashboard,
  showAutomationDetails
}: {
  pageView: 'automations' | 'runs' | 'run'
  isDetailOpen: boolean
  selectedAutomationName?: string
  runPageOrigin: 'automation' | 'runs'
  ownerNotice: AutomationActionNotice | null
  recoverOwnerAction: (action: AutomationHostRecoveryAction) => void
  dismissOwnerAction: () => void
  showAutomationsList: () => void
  showRunsDashboard: () => void
  showAutomationDetails: () => void
}): React.JSX.Element {
  const t = useTranslate()
  return (
    <>
      <PageHeader
        topOfWindow
        title={
          pageView === 'runs' || pageView === 'run' ? (
            <AutomationsPageBreadcrumb
              current={pageView}
              onBackToAutomations={showAutomationsList}
              onBackToRuns={showRunsDashboard}
              automationName={runPageOrigin === 'automation' ? selectedAutomationName : undefined}
              onBackToAutomation={showAutomationDetails}
            />
          ) : isDetailOpen && selectedAutomationName ? (
            <AutomationsPageBreadcrumb
              current="automation"
              automationName={selectedAutomationName}
              onBackToAutomations={showAutomationsList}
            />
          ) : (
            t('auto.components.automations.AutomationsPage.77c2778945', 'Automations')
          )
        }
      />
      <AutomationOwnerConflictNotice
        notice={ownerNotice}
        className="mx-4 mb-2"
        onRecover={recoverOwnerAction}
        onDismiss={dismissOwnerAction}
      />
    </>
  )
}

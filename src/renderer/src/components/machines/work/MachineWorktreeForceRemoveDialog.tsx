import React from 'react'
import { useTranslate } from '@/i18n/use-translate'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import type { MachineWorktreeRemovalRefusal } from '../../../../../shared/machines/machine-worktree-removal-refusal'

export type MachineWorktreeForceRemoveRequest = {
  path: string
  label: string
  refusal: MachineWorktreeRemovalRefusal
}

/** Git refused the removal; deleting anyway loses work, so it is always confirmed. */
export function MachineWorktreeForceRemoveDialog({
  request,
  onCancel,
  onConfirm
}: {
  request: MachineWorktreeForceRemoveRequest | null
  onCancel: () => void
  onConfirm: (request: MachineWorktreeForceRemoveRequest) => void
}): React.JSX.Element | null {
  const t = useTranslate()
  if (!request) {
    return null
  }
  const { refusal } = request
  const locked = refusal.kind === 'locked'
  return (
    <Dialog open onOpenChange={(open) => (!open ? onCancel() : undefined)}>
      <DialogContent surface="security" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {locked
              ? t('auto.components.machines.work.unlockTitle', 'Unlock and delete “{{name}}”?', {
                  name: request.label
                })
              : t('auto.components.machines.work.forceTitle', 'Force delete “{{name}}”?', {
                  name: request.label
                })}
          </DialogTitle>
          <DialogDescription>
            {locked
              ? t(
                  'auto.components.machines.work.unlockBody',
                  'Git locked this worktree so it would not be removed. Seal will override that lock and permanently delete the worktree and every file in it, including uncommitted changes.'
                )
              : refusal.kind === 'submodules'
                ? t(
                    'auto.components.machines.work.forceSubmodulesBody',
                    'This worktree contains submodules, so Git removes it only when forced. That permanently deletes it and anything in those submodules that was never pushed.'
                  )
                : t(
                    'auto.components.machines.work.forceChangesBody',
                    'This worktree has modified or untracked files. Force delete permanently removes it and those files.'
                  )}
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-md border border-border/70 bg-muted/35 px-3 py-2 text-xs">
          <div className="break-all font-mono text-foreground">{request.path}</div>
          {locked && refusal.reason ? (
            <div className="mt-1 text-muted-foreground">
              {t('auto.components.machines.work.lockReason', 'Lock reason: {{reason}}', {
                reason: refusal.reason
              })}
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            {t('auto.components.machines.work.forceCancel', 'Cancel')}
          </Button>
          <Button variant="destructive" onClick={() => onConfirm(request)}>
            {locked
              ? t('auto.components.machines.work.unlockConfirm', 'Unlock & Delete')
              : t('auto.components.machines.work.forceConfirm', 'Force Delete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

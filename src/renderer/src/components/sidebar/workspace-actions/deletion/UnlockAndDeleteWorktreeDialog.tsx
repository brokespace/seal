import { useState } from 'react'
import { LockOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { useTranslate } from '@/i18n/use-translate'

/** Git's lock is someone's request to keep the worktree, so releasing it always asks first. */
export function UnlockAndDeleteWorktreeDialog({
  worktreeName,
  lockReason,
  onConfirm
}: {
  worktreeName: string
  lockReason: string | null
  onConfirm: () => void
}): React.JSX.Element {
  const t = useTranslate()
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button type="button" variant="destructive" size="sm" onClick={() => setOpen(true)}>
        <LockOpen />
        {t('workspaceDeletion.unlockAndDelete', 'Unlock & Delete')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent surface="security" className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {t('workspaceDeletion.unlockConfirmTitle', 'Unlock and delete “{{name}}”?', {
                name: worktreeName
              })}
            </DialogTitle>
            <DialogDescription>
              {t(
                'workspaceDeletion.unlockConfirmBody',
                'Git locked this workspace so it would not be removed. Seal will release that lock, then permanently delete the workspace and every file in it, including uncommitted changes.'
              )}
            </DialogDescription>
          </DialogHeader>
          {lockReason ? (
            <div className="rounded-md border border-border/70 bg-muted/35 px-3 py-2 text-xs">
              <div className="text-muted-foreground">
                {t('workspaceDeletion.unlockConfirmReason', 'Lock reason')}
              </div>
              <div className="mt-0.5 break-words font-mono text-foreground">{lockReason}</div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t('workspaceDeletion.unlockConfirmCancel', 'Cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setOpen(false)
                onConfirm()
              }}
            >
              {t('workspaceDeletion.unlockAndDelete', 'Unlock & Delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

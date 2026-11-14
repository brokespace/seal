import React, { useState } from 'react'
import { toast } from 'sonner'
import { useTranslate } from '@/i18n/use-translate'
import { SshTargetForm } from '@/components/settings/ssh/targets/SshTargetForm'
import { buildSshTargetSavePayload } from '@/components/settings/ssh/targets/ssh-target-save-payload'
import {
  EMPTY_FORM,
  getEditingTargetForSshTarget,
  type EditingTarget
} from '@/components/ssh-host-form/ssh-target-draft'
import type { SshTarget } from '../../../../../shared/ssh-types'

async function saveMachineEdit(targetId: string, form: EditingTarget): Promise<string | null> {
  const result = buildSshTargetSavePayload(form)
  if (!result.ok) {
    return result.error
  }
  try {
    await window.api.ssh.updateTarget({ id: targetId, updates: result.payload.updates })
    return null
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

export function MachineEditDialog({
  target,
  onClose,
  onSaved
}: {
  target: SshTarget | null
  onClose: () => void
  onSaved: () => void
}): React.JSX.Element {
  const t = useTranslate()
  const [form, setForm] = useState<EditingTarget>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [seededFor, setSeededFor] = useState<SshTarget | null>(null)
  if (seededFor !== target) {
    setSeededFor(target)
    setForm(target ? getEditingTargetForSshTarget(target) : EMPTY_FORM)
  }

  const save = async (): Promise<void> => {
    if (!target || saving) {
      return
    }
    setSaving(true)
    const error = await saveMachineEdit(target.id, form)
    setSaving(false)
    if (error) {
      toast.error(error)
      return
    }
    toast.success(t('auto.components.machines.edit.saved', 'Machine updated'))
    onSaved()
    onClose()
  }

  return (
    <SshTargetForm
      open={target !== null}
      editingId={target?.id ?? null}
      form={form}
      saving={saving}
      onFormChange={setForm}
      onSave={() => void save()}
      onOpenChange={(open) => !open && onClose()}
    />
  )
}

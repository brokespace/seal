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
import type { MachineId } from '../../../../../shared/machines/machine-types'
import type { SshTarget } from '../../../../../shared/ssh-types'
import { readIpcErrorMessage } from '@/runtime/errors/ipc-error'

async function saveMachineEdit(
  machineId: MachineId,
  target: SshTarget,
  form: EditingTarget
): Promise<string | null> {
  const result = buildSshTargetSavePayload(form)
  if (!result.ok) {
    return result.error
  }
  try {
    await window.api.ssh.updateTarget({ id: target.id, updates: result.payload.updates })
    const label = form.label.trim()
    // The machine keeps its own name, so a new label has to be carried over to it.
    if (label && label !== target.label) {
      await window.api.machines?.renameMachine({ machineId, name: label })
    }
    return null
  } catch (error) {
    return readIpcErrorMessage(error) ?? String(error)
  }
}

export function MachineEditDialog({
  machineId,
  target,
  onClose,
  onSaved
}: {
  machineId: MachineId
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
    const error = await saveMachineEdit(machineId, target, form)
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

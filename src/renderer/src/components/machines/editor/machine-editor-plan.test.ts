import { describe, expect, it } from 'vitest'
import { planMachineEditorOpen } from './machine-editor-plan'

const VSCODE = { id: 'vscode', label: 'VS Code', command: 'code' }
const CURSOR = { id: 'cursor', label: 'Cursor', command: 'cursor' }
const SUBLIME = { id: 'subl', label: 'Sublime Text', command: 'subl' }

describe('planMachineEditorOpen', () => {
  it('dials the stored SSH details whichever transport Seal is using', () => {
    for (const connection of ['ssh', 'server'] as const) {
      expect(planMachineEditorOpen({ connection, sshTargetId: 'ssh-1' }, [VSCODE])).toEqual({
        kind: 'external',
        application: VSCODE,
        sshTargetId: 'ssh-1'
      })
    }
  })

  it('opens a Seal-server machine without SSH details in Seal’s own editor', () => {
    expect(
      planMachineEditorOpen({ connection: 'server', sshTargetId: null }, [VSCODE, CURSOR])
    ).toEqual({ kind: 'built-in', reason: 'no-ssh-details' })
  })

  it('skips apps that cannot open a path over SSH', () => {
    const remote = { connection: 'ssh', sshTargetId: 'ssh-1' } as const

    expect(planMachineEditorOpen(remote, [SUBLIME, CURSOR])).toEqual({
      kind: 'external',
      application: CURSOR,
      sshTargetId: 'ssh-1'
    })
    expect(planMachineEditorOpen(remote, [SUBLIME])).toEqual({
      kind: 'built-in',
      reason: 'no-remote-editor'
    })
    expect(planMachineEditorOpen(remote, [VSCODE, CURSOR], 'subl')).toEqual({
      kind: 'external',
      application: VSCODE,
      sshTargetId: 'ssh-1'
    })
  })

  it('uses the app the user picked, and any app on this computer', () => {
    const local = { connection: 'local', sshTargetId: null } as const

    expect(planMachineEditorOpen(local, [SUBLIME, CURSOR], 'cursor')).toEqual({
      kind: 'external',
      application: CURSOR,
      sshTargetId: null
    })
    expect(planMachineEditorOpen(local, [SUBLIME, CURSOR])).toEqual({
      kind: 'external',
      application: SUBLIME,
      sshTargetId: null
    })
    expect(planMachineEditorOpen(local, [])).toEqual({ kind: 'built-in', reason: 'no-apps' })
  })
})

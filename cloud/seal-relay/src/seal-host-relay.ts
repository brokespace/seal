import { HostRelay } from '../../../cloud/apps/relay-edge/src/host-relay'

export type SealAssignment = { assignmentEpoch: number }

// Seal has a single cell (this Worker), so the director role reduces to pinning each host here.
export class SealHostRelay extends HostRelay {
  async sealAssign(userId: string, relayHostId: string, cellId: string): Promise<SealAssignment> {
    const current = this.store.assignment()
    if (current && current.userId === userId && current.cellId === cellId) {
      return { assignmentEpoch: current.assignmentEpoch }
    }
    const result = await this.store.applyAssignment({
      userId,
      relayHostId,
      cellId,
      assignmentEpoch: (current?.assignmentEpoch ?? 0) + 1,
      // A host new to this object starts with no paired phones; pairing adds them.
      ...(current ? {} : { devices: [] })
    })
    await this.reschedule()
    return { assignmentEpoch: result.assignmentEpoch }
  }

  /**
   * Where a paired phone finds this host. Only a phone holding a live resume credential is told;
   * a host nobody assigned has no tables, and asking must not create them.
   */
  async sealResolve(
    relayHostId: string,
    resumeToken: string,
    cellId: string
  ): Promise<SealAssignment | null> {
    if (!this.pushed()) {
      return null
    }
    const current = this.store.assignment()
    if (!current || current.cellId !== cellId) {
      return null
    }
    const found = await this.backend.lookupResume(relayHostId, resumeToken)
    return found.outcome === 'resume' ? { assignmentEpoch: current.assignmentEpoch } : null
  }
}

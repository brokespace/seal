import { activeMachineConnection, type MachineStore } from '../../../shared/machines/machine-record'
import { toMachineId } from '../../../shared/machines/machine-types'
import type { MachineView } from '../../../shared/machines/machine-view'
import type { MachineRegistryEnvironment, MachineRegistrySshTarget } from './machine-registry'

function sshAddress(target: MachineRegistrySshTarget): string {
  const host = target.host || target.configHost || target.label
  const user = target.username ? `${target.username}@` : ''
  const port = target.port && target.port !== 22 ? `:${target.port}` : ''
  return `${user}${host}${port}`
}

/** What the renderer shows per machine: both transports' stored details, and which one is in use. */
export function buildMachineViews(
  store: MachineStore,
  sshTargets: readonly MachineRegistrySshTarget[],
  environments: readonly MachineRegistryEnvironment[]
): MachineView[] {
  const targets = new Map(sshTargets.map((target) => [target.id, target]))
  const servers = new Map(environments.map((environment) => [environment.id, environment]))
  return store.machines
    .map((record): MachineView | null => {
      const connection = activeMachineConnection(record)
      if (!connection) {
        return null
      }
      const target = record.sshTargetId ? targets.get(record.sshTargetId) : undefined
      const environment = record.environmentId ? servers.get(record.environmentId) : undefined
      return {
        id: toMachineId(record.id),
        recordId: record.id,
        name: record.name,
        connection,
        ssh: target
          ? {
              targetId: target.id,
              address: sshAddress(target),
              host: target.host || target.configHost || '',
              username: target.username,
              port: target.port,
              identityFile: target.identityFile ?? null,
              jumpHost: target.jumpHost ?? null
            }
          : null,
        server: environment
          ? {
              environmentId: environment.id,
              name: environment.name,
              endpoint: environment.preferredEndpoint
            }
          : null
      }
    })
    .filter((view): view is MachineView => view !== null)
    .sort((a, b) => a.name.localeCompare(b.name))
}

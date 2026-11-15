import { z } from 'zod'

/** How Seal reaches a machine; exactly one is live, the other's details stay stored for switching. */
export const MachineConnectionTypeSchema = z.enum(['ssh', 'server'])
export type MachineConnectionType = z.infer<typeof MachineConnectionTypeSchema>

/** Whether Seal installs its server on an SSH machine, and how the last attempt went. */
export const MachineServerInstallSchema = z.object({
  /** `auto` unless the user unticked the box when adding the machine. */
  policy: z.enum(['auto', 'never']),
  state: z.enum(['installed', 'failed', 'declined', 'pending']),
  /** How the server is kept running. */
  manager: z.enum(['systemd-user', 'launchd', 'pm2', 'detached']).optional(),
  /** systemd only: the service survives logout and reboot. */
  linger: z.boolean().optional(),
  /** Why the last attempt failed. */
  reason: z.string().optional(),
  version: z.string().optional(),
  attemptedAt: z.number().optional()
})
export type MachineServerInstall = z.infer<typeof MachineServerInstallSchema>

/**
 * One machine the user works with. SSH config lives on the linked SSH target and the Seal server
 * on the linked runtime environment; the record binds them and says which one Seal uses.
 */
export const MachineRecordSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  connection: MachineConnectionTypeSchema,
  sshTargetId: z.string().min(1).nullable(),
  environmentId: z.string().min(1).nullable(),
  /** Lowercased hostnames the machine reported over either transport. */
  hostnames: z.array(z.string()).catch([]),
  /** OS machine ids (/etc/machine-id, IOPlatformUUID, MachineGuid) seen over either transport. */
  machineIds: z.array(z.string()).catch([]),
  /** Absent on machines added before Seal installed its server by default. */
  serverInstall: MachineServerInstallSchema.optional().catch(undefined),
  createdAt: z.number(),
  updatedAt: z.number()
})
export type MachineRecord = z.infer<typeof MachineRecordSchema>

/** A user-split pair is never merged again automatically. */
export const MachineSeparationSchema = z.object({
  sshTargetId: z.string().min(1),
  environmentId: z.string().min(1)
})
export type MachineSeparation = z.infer<typeof MachineSeparationSchema>

export const MachineStoreSchema = z.object({
  version: z.literal(1),
  machines: z.array(MachineRecordSchema),
  separations: z.array(MachineSeparationSchema).catch([])
})
export type MachineStore = z.infer<typeof MachineStoreSchema>

export const EMPTY_MACHINE_STORE: MachineStore = { version: 1, machines: [], separations: [] }

export type MachineIdentity = { hostname: string | null; machineId: string | null }

/** The transport a record uses, falling back to the one it has when its choice lost its link. */
export function activeMachineConnection(record: MachineRecord): MachineConnectionType | null {
  if (record.connection === 'server' && record.environmentId) {
    return 'server'
  }
  if (record.connection === 'ssh' && record.sshTargetId) {
    return 'ssh'
  }
  return record.sshTargetId ? 'ssh' : record.environmentId ? 'server' : null
}

import {
  loadRemotePushHostRegistrations,
  saveRemotePushHostRegistrations
} from '../../storage/preferences'

/** Hosts holding this phone's push token, and hosts still owed an unregister. */
type RegistrationRecords = { registered: Set<string>; pending: Set<string> }

let registrationRecords: RegistrationRecords | null = null

export async function readHostPushRegistrationRecords(): Promise<RegistrationRecords> {
  if (!registrationRecords) {
    const stored = await loadRemotePushHostRegistrations()
    registrationRecords ??= {
      registered: new Set(stored.registeredHostIds),
      pending: new Set(stored.pendingUnregisterHostIds)
    }
  }
  return registrationRecords
}

export async function mutateHostPushRegistrationRecords(
  mutate: (value: RegistrationRecords) => void
): Promise<void> {
  const value = await readHostPushRegistrationRecords()
  mutate(value)
  await saveRemotePushHostRegistrations({
    registeredHostIds: [...value.registered],
    pendingUnregisterHostIds: [...value.pending]
  })
}

export function resetHostPushRegistrationRecordsForTests(): void {
  registrationRecords = null
}

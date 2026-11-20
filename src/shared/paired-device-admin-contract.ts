import * as z from 'zod'

// Only this host's own user holds these: a paired phone or desktop can never list or revoke devices.
export const PAIRED_DEVICES_LIST_METHOD = 'pairing.listDevices'
export const PAIRED_DEVICES_REVOKE_METHOD = 'pairing.revokeDevices'

export const PairedDevicesListParamsSchema = z.object({}).strict()

export const PairedDevicesRevokeParamsSchema = z
  .object({
    deviceIds: z.array(z.string().min(1).max(128)).min(1).max(256).optional(),
    all: z.boolean().optional()
  })
  .strict()
  .refine((params) => (params.all === true) !== (params.deviceIds !== undefined), {
    message: 'name the devices to revoke, or all of them'
  })

export type PairedDevicesRevokeParams = z.infer<typeof PairedDevicesRevokeParamsSchema>

/** What an operator needs to pick a device; never its credential. */
export type PairedDeviceSummary = {
  deviceId: string
  name: string
  scope: 'mobile' | 'runtime'
  credential: 'token' | 'device-key'
  /** An offer nobody has used yet; it stops pairing at `offerExpiresAt`. */
  state: 'paired' | 'offer'
  pairedAt: number
  /** 0 until first used. */
  lastSeenAt: number
  offerExpiresAt?: number
  /** `relay` names its relay credential; `via-desktop` is a phone a paired desktop relays. */
  route: 'direct' | 'relay' | 'via-desktop'
  relayDeviceId?: string
  parentDeviceId?: string
  /** The pairing this device key was registered from. */
  forkedFrom?: string
  grants?: string[]
}

export type PairedDevicesListResult = { devices: PairedDeviceSummary[] }

export type PairedDevicesRevokeResult = {
  /** Named devices and everything paired through them (their keys, the phones a desktop relays). */
  revoked: PairedDeviceSummary[]
  notFound: string[]
}

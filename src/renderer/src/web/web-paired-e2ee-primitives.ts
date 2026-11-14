import nacl from 'tweetnacl'
import { decodeBase64Bytes } from '@/lib/base64-bytes'
import type { PairedE2EEPrimitives } from '../../../shared/remote-runtime/e2ee/paired-e2ee-primitives'
import { derivePairedE2EEV2KeySchedule } from '../../../shared/remote-runtime/e2ee/paired-e2ee-v2-key-schedule'
import { generateKeyPair, publicKeyFromBase64, publicKeyToBase64, x25519 } from './web-e2ee'

export const WEB_PAIRED_E2EE_PRIMITIVES: PairedE2EEPrimitives = {
  generateKeyPair,
  x25519,
  randomBytes: (length) => nacl.randomBytes(length),
  encodeBase64: publicKeyToBase64,
  decodeBase64: decodeBase64Bytes,
  publicKeyFromBase64,
  publicKeyToBase64,
  deriveV2KeySchedule: derivePairedE2EEV2KeySchedule
}

import {
  REMOTE_RUNTIME_MAX_OUTBOUND_BINARY_FRAME_BYTES,
  REMOTE_RUNTIME_MAX_OUTBOUND_JSON_BYTES
} from '../../../../../shared/remote-runtime/remote-runtime-memory-limits'
import type { EventProps } from '../../../../../shared/telemetry-event-classification'
import { track } from '../../../../telemetry/client'

export type MobileE2EEOutboundBudgetEmitter = EventProps<'remote_outbound_budget_close'>['emitter']

export function trackMobileE2EEOutboundBudgetClose(emitter: MobileE2EEOutboundBudgetEmitter): void {
  try {
    track('remote_outbound_budget_close', { emitter })
  } catch {
    // Telemetry is best-effort; closing the unsafe socket remains authoritative.
  }
}

export function mobileE2EETextPayloadAdmissionBytes(value: string): number {
  const bytes = Buffer.byteLength(value, 'utf8')
  return bytes <= REMOTE_RUNTIME_MAX_OUTBOUND_JSON_BYTES ? bytes : Number.POSITIVE_INFINITY
}

export function isMobileE2EETextPayloadWithinLimit(value: string): boolean {
  return Number.isFinite(mobileE2EETextPayloadAdmissionBytes(value))
}

export function mobileE2EEBinaryPayloadAdmissionBytes(value: Uint8Array<ArrayBufferLike>): number {
  return value.byteLength <= REMOTE_RUNTIME_MAX_OUTBOUND_BINARY_FRAME_BYTES
    ? value.byteLength
    : Number.POSITIVE_INFINITY
}

export function isMobileE2EEBinaryPayloadWithinLimit(value: Uint8Array<ArrayBufferLike>): boolean {
  return Number.isFinite(mobileE2EEBinaryPayloadAdmissionBytes(value))
}

export function isMobileE2EEOutboundItemWithinLimit(
  item:
    | { kind: 'text'; plaintext: string }
    | { kind: 'binary'; plaintext: Uint8Array<ArrayBufferLike> }
): boolean {
  return item.kind === 'text'
    ? isMobileE2EETextPayloadWithinLimit(item.plaintext)
    : isMobileE2EEBinaryPayloadWithinLimit(item.plaintext)
}

import { translate } from '../../i18n/mobile-i18n'
import type { PhoneUploadSource } from './phone-upload-source'

// The host-served page has no device file access; these actions run in the native app only.
function unavailable(): Error {
  return new Error(
    translate('seal.transfers.deviceUnavailable', 'Phone files are available in the Seal app')
  )
}

export async function pickPhotosForUpload(): Promise<PhoneUploadSource[]> {
  throw unavailable()
}

export async function pickFilesForUpload(): Promise<PhoneUploadSource[]> {
  throw unavailable()
}

export async function presentShareSheet(_uri: string, _mimeType: string): Promise<void> {
  throw unavailable()
}

export async function presentPdfViewer(_uri: string): Promise<void> {
  throw unavailable()
}

export async function saveImageToLibrary(_uri: string, _mimeType: string): Promise<void> {
  throw unavailable()
}

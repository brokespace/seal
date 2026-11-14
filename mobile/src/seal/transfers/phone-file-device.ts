import { Platform } from 'react-native'
import * as DocumentPicker from 'expo-document-picker'
import { File as FsFile } from 'expo-file-system'
import * as ImagePicker from 'expo-image-picker'
import {
  presentPdf,
  saveImageToPhotos,
  shareImage
} from '../../../modules/orca-mobile-web-shell/src/index'
import { ImageLibraryPermissionError } from '../../platform/media-picking/media-picker-contract'
import { mobileFileExtensionForMime } from '../../platform/media-picking/mobile-picked-file-name'
import type { PhoneUploadSource } from './phone-upload-source'

// Native pickers and presenters; the page bundle resolves the .web sibling because these throw at import in a browser.

const UNKNOWN_MIME = 'application/octet-stream'

function sizeOf(uri: string, reported: number | null | undefined): number {
  return typeof reported === 'number' && reported >= 0 ? reported : new FsFile(uri).size
}

export async function pickPhotosForUpload(): Promise<PhoneUploadSource[]> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync()
  if (!permission.granted) {
    throw new ImageLibraryPermissionError()
  }
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images', 'videos'],
    allowsMultipleSelection: true,
    selectionLimit: 0,
    orderedSelection: true,
    base64: false,
    exif: false,
    quality: 1,
    // A file transfer keeps the original bytes (HEIC stays HEIC).
    preferredAssetRepresentationMode:
      ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current
  })
  if (result.canceled) {
    return []
  }
  return result.assets.flatMap((asset, index): PhoneUploadSource[] => {
    if (!asset.uri) {
      return []
    }
    const mimeType = asset.mimeType ?? UNKNOWN_MIME
    const extension = mobileFileExtensionForMime(mimeType)
    const fallback = `photo-${Date.now()}-${index + 1}${extension ? `.${extension}` : ''}`
    return [
      {
        uri: asset.uri,
        fileName: asset.fileName?.trim() || fallback,
        size: sizeOf(asset.uri, asset.fileSize),
        mimeType
      }
    ]
  })
}

export async function pickFilesForUpload(): Promise<PhoneUploadSource[]> {
  const result = await DocumentPicker.getDocumentAsync({
    type: '*/*',
    multiple: true,
    copyToCacheDirectory: true
  })
  if (result.canceled) {
    return []
  }
  return result.assets.flatMap((asset): PhoneUploadSource[] =>
    asset.uri
      ? [
          {
            uri: asset.uri,
            fileName: asset.name.trim() || 'file',
            size: sizeOf(asset.uri, asset.size),
            mimeType: asset.mimeType ?? UNKNOWN_MIME
          }
        ]
      : []
  )
}

// iOS presenters take the file:// URI; Android needs a FileProvider content:// URI it can grant to another app.
function presentableUri(uri: string): string {
  return Platform.OS === 'android' && uri.startsWith('file:') ? new FsFile(uri).contentUri : uri
}

// The shell module's share sheet is file-generic despite its name: UIActivityViewController / ACTION_SEND.
export function presentShareSheet(uri: string, mimeType: string): Promise<void> {
  return shareImage(presentableUri(uri), mimeType)
}

export function presentPdfViewer(uri: string): Promise<void> {
  return presentPdf(presentableUri(uri))
}

export function saveImageToLibrary(uri: string, mimeType: string): Promise<void> {
  return saveImageToPhotos(presentableUri(uri), mimeType)
}

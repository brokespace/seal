/** A file on the phone, picked for upload and read in chunks from `uri`. */
export type PhoneUploadSource = {
  uri: string
  fileName: string
  size: number
  mimeType: string
}

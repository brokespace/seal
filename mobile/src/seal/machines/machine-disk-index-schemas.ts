import * as z from 'zod'

const nullableNumber = z.number().finite().nullable().catch(null)
const size = z.number().nonnegative().catch(0)

const diskMountSchema = z.looseObject({
  mount: z.string().min(1),
  filesystem: z.string().catch(''),
  totalBytes: size,
  usedBytes: size,
  availableBytes: size,
  indexed: z.boolean().catch(false),
  skipReason: z.enum(['virtual', 'network', 'removable', 'excluded']).nullable().catch(null),
  scannedAt: nullableNumber,
  indexedFiles: nullableNumber
})

export type MobileMachineDiskMount = z.output<typeof diskMountSchema>

const diskScanSchema = z.looseObject({
  mount: z.string(),
  files: size,
  bytes: size,
  folders: size,
  expectedFolders: nullableNumber
})

export const machineDiskStatusSchema = z.looseObject({
  status: z.looseObject({
    source: z.enum(['index', 'live']).catch('live'),
    unavailableReason: z
      .enum(['no-node', 'no-program', 'install-failed', 'daemon-failed', 'command-failed'])
      .nullable()
      .catch(null),
    unavailableDetail: z.string().nullable().catch(null),
    mounts: z.array(diskMountSchema),
    scan: diskScanSchema.nullable().catch(null),
    now: z.number().catch(0),
    generation: z.number().catch(0)
  })
})

export type MobileMachineDiskStatus = z.output<typeof machineDiskStatusSchema>['status']

const diskEntrySchema = z.looseObject({
  name: z.string().min(1),
  path: z.string().min(1),
  kind: z.enum(['directory', 'file', 'symlink']).catch('file'),
  bytes: nullableNumber,
  notIndexed: z.boolean().catch(false),
  unreadable: z.boolean().catch(false)
})

export type MobileMachineDiskEntry = z.output<typeof diskEntrySchema>

export const machineDiskListingSchema = z.looseObject({
  listing: z.looseObject({
    path: z.string().min(1),
    totalBytes: nullableNumber,
    entries: z.array(diskEntrySchema),
    omittedCount: size,
    omittedBytes: size,
    incomplete: z.boolean().catch(false),
    scannedAt: nullableNumber
  })
})

export type MobileMachineDiskListing = z.output<typeof machineDiskListingSchema>['listing']

const diskLargestItemSchema = z.looseObject({
  path: z.string().min(1),
  bytes: size,
  files: nullableNumber
})

export type MobileMachineDiskLargestItem = z.output<typeof diskLargestItemSchema>

export const machineDiskLargestSchema = z.looseObject({
  largest: z.looseObject({
    kind: z.enum(['files', 'folders']),
    items: z.array(diskLargestItemSchema),
    scannedAt: nullableNumber
  })
})

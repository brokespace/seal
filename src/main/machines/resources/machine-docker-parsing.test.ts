import { describe, expect, it } from 'vitest'
import { parseDockerLogs } from './machine-docker-container-logs'
import { parseDockerContainers } from './machine-docker-containers'
import { parseDockerDetails } from './machine-docker-details'
import { parseDockerInventory } from './machine-docker-inventory'
import { classifyDockerUnreachable } from './machine-docker-output'
import { dockerVolumeHelperImages, normalizeDockerVolumePath } from './machine-docker-volume-files'

// Output recorded from Docker 29.1.3 on Linux (containerd image store).
const RUN_ID = '48030c697af5bb4b024de16fc15545b765f1cf26ccc27d194d2775832b2b07e0'
const EXITED_ID = 'ed4d0fbd232a83d195977995065fcb0b470d6be2e34cdec86238ffc9f04d3d79'
const BUSYBOX_ID = 'sha256:73aaf090f3d85aa34ee199857f03fa3a95c8ede2ffd4cc2cdb5b94e566b11662'
const DANGLING_ID = 'sha256:7b9977ff438272c856f6ce38d5190478d49e4215d7917bdb1683672cc17c486b'
const ALPINE_ID = 'sha256:d9e853e87e55526f6b2917df91a2115c36dd7c696a35be12163d44e6e2a4b6bc'

const CONTAINER_USES = [
  `@k {"Id":"${RUN_ID}","Name":"/seal-probe-run","State":"running","Running":true,"Image":"busybox:1.36","ImageID":"${BUSYBOX_ID}","Mounts":[{"Destination":"/data","Driver":"local","Mode":"z","Name":"seal-probe-vol","Propagation":"","RW":true,"Source":"/var/lib/docker/volumes/seal-probe-vol/_data","Type":"volume"}]}`,
  `@k {"Id":"${EXITED_ID}","Name":"/seal-probe-exited","State":"exited","Running":false,"Image":"busybox:1.36","ImageID":"${BUSYBOX_ID}","Mounts":[]}`
]

const INVENTORY = [
  '@ready',
  '@d {"Active":"1","Reclaimable":"813.1MB (23%)","Size":"3.484GB","TotalCount":"8","Type":"Images"}',
  '@d {"Active":"1","Reclaimable":"4.096kB (33%)","Size":"12.29kB","TotalCount":"2","Type":"Containers"}',
  '@d {"Active":"1","Reclaimable":"0B (0%)","Size":"8B","TotalCount":"2","Type":"Local Volumes"}',
  '@d {"Active":"0","Reclaimable":"12.29kB","Size":"4.347MB","TotalCount":"5","Type":"Build Cache"}',
  '@b {"CacheType":"regular","CreatedAt":"2026-11-16 20:34:23.690354391 +0000 UTC","CreatedSince":"1 second ago","Description":"","ID":"ov8x48xn3tqou3tn3html89lu","InUse":"false","LastUsedAt":"2026-11-16 20:34:24.129469815 +0000 UTC","LastUsedSince":"Less than a second ago","Parent":"","Shared":"true","Size":"2.21MB","UsageCount":"1"}',
  '@b {"CacheType":"regular","CreatedAt":"2026-11-16 20:34:23.814703076 +0000 UTC","CreatedSince":"Less than a second ago","Description":"mount / from exec /bin/sh -c echo main-probe \\u003e /hi","ID":"cusxop8a23bg5e5f1ixhlva5q","InUse":"false","LastUsedAt":"2026-11-16 20:34:24.129550891 +0000 UTC","LastUsedSince":"Less than a second ago","Parent":"ov8x48xn3tqou3tn3html89lu","Shared":"true","Size":"2.12MB","UsageCount":"1"}',
  '@omitted 3',
  `@c {"ID":"${RUN_ID}","CreatedAt":"2026-11-16 19:53:02 +0000 UTC","Status":"Up 41 minutes","Size":"8.19kB"}`,
  `@c {"ID":"${EXITED_ID}","CreatedAt":"2026-11-16 19:53:02 +0000 UTC","Status":"Exited (0) 41 minutes ago","Size":"4.1kB"}`,
  `@i {"Containers":"0","CreatedAt":"2026-11-16 19:53:17 +0000 UTC","CreatedSince":"41 minutes ago","Digest":"","ID":"${DANGLING_ID}","Repository":"\\u003cnone\\u003e","SharedSize":"7.7MB","Size":"9.96MB","Tag":"\\u003cnone\\u003e","UniqueSize":"2.261MB"}`,
  `@i {"Containers":"2","CreatedAt":"2023-05-18 22:34:17 +0000 UTC","CreatedSince":"3 years ago","Digest":"","ID":"${BUSYBOX_ID}","Repository":"busybox","SharedSize":"4.551MB","Size":"6.76MB","Tag":"1.36","UniqueSize":"2.21MB"}`,
  '@v {"Name":"seal-probe-vol","Links":"1","Size":"8B"}',
  '@v {"Name":"seal-probe-unused","Links":"0","Size":"0B"}',
  ...CONTAINER_USES,
  '@m {"Name":"seal-probe-unused","Driver":"local","Mountpoint":"/var/lib/docker/volumes/seal-probe-unused/_data"}',
  '@m {"Name":"seal-probe-vol","Driver":"local","Mountpoint":"/var/lib/docker/volumes/seal-probe-vol/_data"}',
  // `image ls` names both tags of an image that `system df` lists under one.
  `@t {"ID":"${BUSYBOX_ID}","Repository":"busybox","Tag":"1.36"}`,
  `@t {"ID":"${BUSYBOX_ID}","Repository":"seal-probe-copy","Tag":"1"}`,
  `@t {"ID":"${DANGLING_ID}","Repository":"\\u003cnone\\u003e","Tag":"\\u003cnone\\u003e"}`
].join('\n')

const RUN_REF = { id: RUN_ID, name: 'seal-probe-run', state: 'running', running: true }
const EXITED_REF = { id: EXITED_ID, name: 'seal-probe-exited', state: 'exited', running: false }

describe('the Docker inventory', () => {
  it('joins sizes with the containers that use each image and volume', () => {
    expect(parseDockerInventory(INVENTORY, 1_800_000_000_000)).toEqual({
      state: 'ready',
      rows: [
        { kind: 'images', count: 8, sizeBytes: 3_484_000_000, reclaimableBytes: 813_100_000 },
        { kind: 'containers', count: 2, sizeBytes: 12_290, reclaimableBytes: 4096 },
        { kind: 'volumes', count: 2, sizeBytes: 8, reclaimableBytes: 0 },
        { kind: 'build-cache', count: 5, sizeBytes: 4_347_000, reclaimableBytes: 12_290 }
      ],
      images: [
        {
          id: DANGLING_ID,
          reference: null,
          tags: [],
          sizeBytes: 9_960_000,
          uniqueBytes: 2_261_000,
          createdAt: 1_794_858_797_000,
          usedBy: []
        },
        {
          id: BUSYBOX_ID,
          reference: 'busybox:1.36',
          tags: ['busybox:1.36', 'seal-probe-copy:1'],
          sizeBytes: 6_760_000,
          uniqueBytes: 2_210_000,
          createdAt: 1_684_449_257_000,
          usedBy: [RUN_REF, EXITED_REF]
        }
      ],
      containers: [
        {
          ...RUN_REF,
          image: 'busybox:1.36',
          imageId: BUSYBOX_ID,
          status: 'Up 41 minutes',
          sizeBytes: 8190,
          createdAt: 1_794_858_782_000,
          volumes: ['seal-probe-vol']
        },
        {
          ...EXITED_REF,
          image: 'busybox:1.36',
          imageId: BUSYBOX_ID,
          status: 'Exited (0) 41 minutes ago',
          sizeBytes: 4100,
          createdAt: 1_794_858_782_000,
          volumes: []
        }
      ],
      volumes: [
        {
          name: 'seal-probe-vol',
          driver: 'local',
          mountpoint: '/var/lib/docker/volumes/seal-probe-vol/_data',
          sizeBytes: 8,
          usedBy: [RUN_REF]
        },
        {
          name: 'seal-probe-unused',
          driver: 'local',
          mountpoint: '/var/lib/docker/volumes/seal-probe-unused/_data',
          sizeBytes: 0,
          usedBy: []
        }
      ],
      buildCache: [
        {
          id: 'ov8x48xn3tqou3tn3html89lu',
          cacheType: 'regular',
          description: '',
          sizeBytes: 2_210_000,
          inUse: false,
          shared: true,
          createdAt: 1_794_861_263_690,
          lastUsedAt: 1_794_861_264_129,
          parents: []
        },
        {
          id: 'cusxop8a23bg5e5f1ixhlva5q',
          cacheType: 'regular',
          description: 'mount / from exec /bin/sh -c echo main-probe > /hi',
          sizeBytes: 2_120_000,
          inUse: false,
          shared: true,
          createdAt: 1_794_861_263_814,
          lastUsedAt: 1_794_861_264_129,
          parents: ['ov8x48xn3tqou3tn3html89lu']
        }
      ],
      buildCacheOmitted: 3,
      collectedAt: 1_800_000_000_000
    })
  })

  it('reads an answer the transport cut short up to the last whole line', () => {
    const cut = INVENTORY.slice(0, INVENTORY.indexOf('"Tag":"1.36"'))
    expect(parseDockerInventory(cut, 0)).toMatchObject({
      state: 'ready',
      images: [{ id: DANGLING_ID }],
      volumes: []
    })
  })
})

describe('the container list', () => {
  it('pairs each running container with its memory, network, disk and process figures', () => {
    const output = [
      '@ready',
      `@c\t${EXITED_ID}\tseal-probe-exited\tbusybox:1.36\tExited (0) 41 minutes ago`,
      `@c\t${RUN_ID}\tseal-probe-run\tbusybox:1.36\tUp 41 minutes`,
      `@s {"BlockIO":"0B / 8.19kB","CPUPerc":"0.25%","Container":"${RUN_ID}","ID":"${RUN_ID}","MemPerc":"0.01%","MemUsage":"464KiB / 47.06GiB","Name":"seal-probe-run","NetIO":"1.99kB / 126B","PIDs":"1"}`
    ].join('\n')

    expect(parseDockerContainers(output)).toEqual({
      state: 'ready',
      containers: [
        {
          id: RUN_ID,
          name: 'seal-probe-run',
          image: 'busybox:1.36',
          status: 'Up 41 minutes',
          running: true,
          memUsageBytes: 475_136,
          memLimitBytes: 50_530_290_237,
          memPercent: 0.01,
          cpuPercent: 0.25,
          netRxBytes: 1990,
          netTxBytes: 126,
          blockReadBytes: 0,
          blockWriteBytes: 8190,
          pids: 1
        },
        {
          id: EXITED_ID,
          name: 'seal-probe-exited',
          image: 'busybox:1.36',
          status: 'Exited (0) 41 minutes ago',
          running: false,
          memUsageBytes: null,
          memLimitBytes: null,
          memPercent: null,
          cpuPercent: null,
          netRxBytes: null,
          netTxBytes: null,
          blockReadBytes: null,
          blockWriteBytes: null,
          pids: null
        }
      ]
    })
    expect(parseDockerContainers('@missing')).toEqual({ state: 'missing' })
  })
})

describe('why Docker does not answer', () => {
  it.each([
    [
      'permission denied while trying to connect to the docker API at unix:///var/run/docker.sock',
      'permission'
    ],
    [
      'Got permission denied while trying to connect to the Docker daemon socket at unix:///var/run/docker.sock: Get "http://%2Fvar%2Frun%2Fdocker.sock/v1.24/containers/json": dial unix /var/run/docker.sock: connect: permission denied',
      'permission'
    ],
    [
      'failed to connect to the docker API at unix:///var/run/docker.sock; check if the path is correct and if the daemon is running: dial unix /var/run/docker.sock: connect: no such file or directory',
      'not-running'
    ],
    [
      'Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?',
      'not-running'
    ],
    ['Error response from daemon: client version 1.52 is too new', 'other']
  ] as const)('%s', (message, reason) => {
    expect(classifyDockerUnreachable(message)).toBe(reason)
  })
})

describe('Docker details', () => {
  it('reads a container: ports, mounts, and no exit code while it runs', () => {
    const document = {
      Id: RUN_ID,
      Created: '2026-11-16T19:53:02.239433813Z',
      Path: 'sh',
      Args: ['-c', 'while true; do echo tick; sleep 5; done'],
      State: {
        Status: 'running',
        Running: true,
        Paused: false,
        Restarting: false,
        OOMKilled: false,
        Dead: false,
        Pid: 5607,
        ExitCode: 0,
        Error: '',
        StartedAt: '2026-11-16T19:53:02.267013775Z',
        FinishedAt: '0001-01-01T00:00:00Z'
      },
      Image: BUSYBOX_ID,
      Name: '/seal-probe-run',
      RestartCount: 0,
      HostConfig: { RestartPolicy: { Name: 'no', MaximumRetryCount: 0 } },
      Mounts: [
        {
          Type: 'volume',
          Name: 'seal-probe-vol',
          Source: '/var/lib/docker/volumes/seal-probe-vol/_data',
          Destination: '/data',
          Driver: 'local',
          Mode: 'z',
          RW: true,
          Propagation: ''
        }
      ],
      Config: { Image: 'busybox:1.36' },
      NetworkSettings: {
        Ports: {
          '443/tcp': null,
          '80/tcp': [
            { HostIp: '0.0.0.0', HostPort: '8080' },
            { HostIp: '::', HostPort: '8080' }
          ]
        },
        Networks: { bridge: {} }
      }
    }

    expect(parseDockerDetails('container', `@o ${JSON.stringify(document)}\n`)).toEqual({
      kind: 'container',
      ...RUN_REF,
      image: 'busybox:1.36',
      imageId: BUSYBOX_ID,
      command: 'sh -c while true; do echo tick; sleep 5; done',
      createdAt: 1_794_858_782_239,
      startedAt: 1_794_858_782_267,
      finishedAt: null,
      exitCode: null,
      restartCount: 0,
      health: null,
      oomKilled: false,
      error: null,
      restartPolicy: 'no',
      ports: ['443/tcp', '0.0.0.0:8080->80/tcp', '[::]:8080->80/tcp'],
      networks: ['bridge'],
      mounts: [
        {
          type: 'volume',
          volume: 'seal-probe-vol',
          source: '/var/lib/docker/volumes/seal-probe-vol/_data',
          destination: '/data',
          readOnly: false
        }
      ]
    })
  })

  it('reads an image: its listed size, its layers, and the containers made from it', () => {
    const output = [
      `@o {"Id":"${BUSYBOX_ID}","RepoTags":["busybox:1.36"],"RepoDigests":["busybox@${BUSYBOX_ID}"],"Created":"2023-05-18T22:34:17Z","Architecture":"amd64","Os":"linux","Size":2217006}`,
      ...CONTAINER_USES,
      '@z 6.76MB',
      `@h {"Comment":"","CreatedAt":"2026-11-16T19:53:17Z","CreatedBy":"/bin/sh -c echo hi2 \\u003e /hi","CreatedSince":"15 minutes ago","ID":"${BUSYBOX_ID}","Size":"8.19kB"}`,
      '@h {"Comment":"","CreatedAt":"2023-05-18T22:34:17Z","CreatedBy":"BusyBox 1.36.1 (glibc), Debian 13","CreatedSince":"3 years ago","ID":"\\u003cmissing\\u003e","Size":"4.55MB"}'
    ].join('\n')

    expect(parseDockerDetails('image', output)).toEqual({
      kind: 'image',
      id: BUSYBOX_ID,
      tags: ['busybox:1.36'],
      digests: [`busybox@${BUSYBOX_ID}`],
      createdAt: 1_684_449_257_000,
      sizeBytes: 6_760_000,
      architecture: 'amd64',
      os: 'linux',
      layers: [
        {
          createdBy: '/bin/sh -c echo hi2 > /hi',
          sizeBytes: 8190,
          createdAt: 1_794_858_797_000
        },
        {
          createdBy: 'BusyBox 1.36.1 (glibc), Debian 13',
          sizeBytes: 4_550_000,
          createdAt: 1_684_449_257_000
        }
      ],
      containers: [RUN_REF, EXITED_REF]
    })
  })

  it('reads a volume and where each container mounts it', () => {
    const output = [
      '@o {"CreatedAt":"2026-11-16T19:53:02Z","Driver":"local","Labels":null,"Mountpoint":"/var/lib/docker/volumes/seal-probe-vol/_data","Name":"seal-probe-vol","Options":null,"Scope":"local"}',
      ...CONTAINER_USES
    ].join('\n')

    expect(parseDockerDetails('volume', output)).toEqual({
      kind: 'volume',
      name: 'seal-probe-vol',
      driver: 'local',
      mountpoint: '/var/lib/docker/volumes/seal-probe-vol/_data',
      scope: 'local',
      createdAt: 1_794_858_782_000,
      labels: {},
      options: {},
      containers: [{ ...RUN_REF, destination: '/data', readOnly: false }]
    })
  })
})

describe('container logs', () => {
  it('drops the line a long log was cut in, and says the log is longer', () => {
    const output = 'T tick 1\n2026-11-16T20:08:47.394684017Z tick 2\n\n@status 0\n'
    expect(parseDockerLogs(output, 5, output.length)).toEqual({
      text: '2026-11-16T20:08:47.394684017Z tick 2\n',
      truncated: true,
      collectedAt: 5
    })
  })

  it('keeps the end of a line that alone is longer than one answer', () => {
    const output = 'xxxx end of one long line\n\n@status 0\n'
    expect(parseDockerLogs(output, 5, output.length)).toEqual({
      text: 'xxxx end of one long line\n',
      truncated: true,
      collectedAt: 5
    })
  })

  it('reports a container that is gone in plain words', () => {
    expect(() =>
      parseDockerLogs('Error response from daemon: No such container: 4f1a\n\n@status 1\n', 0)
    ).toThrow('This container is no longer on the machine.')
  })
})

describe('a path inside a volume', () => {
  it.each([
    ['/', '/'],
    ['/logs/', '/logs'],
    ['//logs//app.log', '/logs/app.log'],
    ["/it's $(reboot).txt", "/it's $(reboot).txt"]
  ])('%s is read as %s', (path, normalized) => {
    expect(normalizeDockerVolumePath(path)).toBe(normalized)
  })

  it.each(['', 'logs', '/logs/../../etc/passwd', '/..', '/./logs', '/a\nb', '/a\0b'])(
    'refuses %j',
    (path) => {
      expect(() => normalizeDockerVolumePath(path)).toThrow('This is not a path inside the volume.')
    }
  )

  it('is read by an image of a container that mounts the volume, then by the smallest ones', () => {
    const lines = [
      ...CONTAINER_USES,
      `@g {"ID":"${DANGLING_ID}","Repository":"\\u003cnone\\u003e","Size":"9.96MB","Tag":"\\u003cnone\\u003e"}`,
      `@g {"ID":"${ALPINE_ID}","Repository":"alpine","Size":"12.2MB","Tag":"3.20"}`,
      `@g {"ID":"${BUSYBOX_ID}","Repository":"busybox","Size":"6.76MB","Tag":"1.36"}`,
      '@g {"ID":"sha256:$(reboot)","Repository":"evil","Size":"1B","Tag":"1"}'
    ]
    expect(dockerVolumeHelperImages('seal-probe-vol', lines)).toEqual([
      BUSYBOX_ID,
      DANGLING_ID,
      ALPINE_ID
    ])
  })
})

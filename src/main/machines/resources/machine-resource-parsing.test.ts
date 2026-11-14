import { describe, expect, it } from 'vitest'
import { maskCommandLineSecrets } from './command-line-secrets'
import { parsePathCleanupScan } from './machine-cleanup-path-scans'
import { parseDiskMounts } from './machine-disk-usage'
import { parseDockerCleanupScan } from './machine-docker-cleanup-scan'
import { parseDockerContainers } from './machine-docker-containers'
import { parseMachineProcessProbe } from './machine-process-probe'

const GIB = 1024 ** 3

describe('process command lines', () => {
  it.each([
    ['node server.js --token abc123 --port 80', 'node server.js --token •••• --port 80'],
    ['env API_KEY=sk-live-1 DEBUG=1 ./run', 'env API_KEY=•••• DEBUG=1 ./run'],
    ['mysql --password=hunter2 -u root', 'mysql --password=•••• -u root'],
    [
      'curl -H Authorization: Bearer abc.def https://x',
      'curl -H Authorization: Bearer •••• https://x'
    ],
    ['psql postgres://app:s3cret@db:5432/app', 'psql postgres://app:••••@db:5432/app'],
    ['tool eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.c2lnbmF0dXJl done', 'tool •••• done'],
    ['vim notes/token-rotation.md', 'vim notes/token-rotation.md']
  ])('masks the secrets in %j', (commandLine, shown) => {
    expect(maskCommandLineSecrets(commandLine)).toBe(shown)
  })
})

describe('a macOS process listing', () => {
  // macOS has no procfs: CPU comes from ps and the start time is the only identity marker.
  const output = [
    '@swapmac total = 2048.00M  used = 512.00M  free = 1536.00M  (encrypted)',
    '@p\t812\t41.5\t\t0\t/Users/brian/.local/bin/claude\tmain:1.0\t  812   790  41.5  3.2 524288 brian                            Sat Nov 14 09:12:44 2026 claude --resume',
    '@p\t790\t0.0\t\t1\t-zsh\t\t  790     1   0.0  0.1   8192 brian                            Sat Nov  7 08:00:01 2026 -zsh',
    '@pane\tmain:1.0\t790\t41.5\t532480\t2',
    '@total 412'
  ].join('\n')

  it('reads swap, identity, tmux pane and agent from ps output', () => {
    expect(parseMachineProcessProbe(output, 7)).toEqual({
      collectedAt: 7,
      totalProcesses: 412,
      cpuBusyPercent: null,
      swap: { totalBytes: 2048 * 1024 ** 2, usedBytes: 512 * 1024 ** 2 },
      tmuxPanes: [
        { pane: 'main:1.0', pid: 790, cpuPercent: 41.5, rssBytes: 532480 * 1024, processCount: 2 }
      ],
      processes: [
        {
          pid: 812,
          ppid: 790,
          user: 'brian',
          name: 'claude',
          command: 'claude --resume',
          cpuPercent: 41.5,
          memPercent: 3.2,
          rssBytes: 524288 * 1024,
          startMarker: 'Sat Nov 14 09:12:44 2026',
          tmuxPane: 'main:1.0',
          agent: 'claude',
          carriesSealConnection: false
        },
        {
          pid: 790,
          ppid: 1,
          user: 'brian',
          name: '-zsh',
          command: '-zsh',
          cpuPercent: 0,
          memPercent: 0.1,
          rssBytes: 8192 * 1024,
          startMarker: 'Sat Nov 7 08:00:01 2026',
          tmuxPane: null,
          agent: null,
          carriesSealConnection: true
        }
      ]
    })
  })
})

describe('disk mounts', () => {
  it('counts the macOS data volume as part of the startup disk', () => {
    const df = [
      'Filesystem     1024-blocks      Used Available Capacity  Mounted on',
      '/dev/disk3s1s1   482797652  10485760 209715200     5%    /',
      'devfs                  203       203         0   100%    /dev',
      '/dev/disk3s6     482797652   1048576 209715200     1%    /System/Volumes/VM',
      '/dev/disk3s5     482797652 262144000 209715200    56%    /System/Volumes/Data',
      'map auto_home            0         0         0   100%    /System/Volumes/Data/home',
      '/dev/disk5s1     976562500 104857600 871704900    11%    /Volumes/Time Machine'
    ].join('\n')

    expect(parseDiskMounts(df).map((mount) => [mount.mount, mount.usedBytes])).toEqual([
      ['/', 279_636_430_848],
      ['/Volumes/Time Machine', 100 * GIB]
    ])
  })

  it('hides pseudo filesystems and container layers on Linux', () => {
    const df = [
      'Filesystem     1024-blocks     Used Available Capacity Mounted on',
      'tmpfs              1638400     2048   1636352       1% /run',
      '/dev/nvme0n1p2   488281250 52428800 435852450      11% /',
      '/dev/nvme0n1p1      523248     6220    517028       2% /boot/efi',
      'overlay          488281250 52428800 435852450      11% /var/lib/docker/overlay2/ab/merged',
      '/dev/sda1       1953125000  1048576 1952076424      1% /mnt/data'
    ].join('\n')

    expect(parseDiskMounts(df).map((mount) => mount.mount)).toEqual(['/', '/mnt/data'])
  })
})

describe('Docker listings', () => {
  it('pairs containers with their memory, largest first', () => {
    const output = [
      '@ready',
      '@c\t43b92ff52610\told-job\talpine:3.20\tExited (0) 2 hours ago',
      '@c\t90f84a0c9638\tweb\tnginx:1.27\tUp 3 days',
      '@c\t1c2d3e4f5a6b\tdb\tpostgres:16\tUp 3 days (healthy)',
      '@s\t90f84a0c9638\t12.5MiB / 2GiB\t0.61%\t1.50%',
      '@s\t1c2d3e4f5a6b\t1.5GiB / 2GiB\t75.00%\t12.25%'
    ].join('\n')

    expect(parseDockerContainers(output)).toEqual({
      state: 'ready',
      containers: [
        {
          id: '1c2d3e4f5a6b',
          name: 'db',
          image: 'postgres:16',
          status: 'Up 3 days (healthy)',
          running: true,
          memUsageBytes: 1.5 * GIB,
          memLimitBytes: 2 * GIB,
          memPercent: 75,
          cpuPercent: 12.25
        },
        {
          id: '90f84a0c9638',
          name: 'web',
          image: 'nginx:1.27',
          status: 'Up 3 days',
          running: true,
          memUsageBytes: 12.5 * 1024 ** 2,
          memLimitBytes: 2 * GIB,
          memPercent: 0.61,
          cpuPercent: 1.5
        },
        {
          id: '43b92ff52610',
          name: 'old-job',
          image: 'alpine:3.20',
          status: 'Exited (0) 2 hours ago',
          running: false,
          memUsageBytes: null,
          memLimitBytes: null,
          memPercent: null,
          cpuPercent: null
        }
      ]
    })
    expect(parseDockerContainers('@unreachable permission denied on docker.sock')).toEqual({
      state: 'unreachable',
      message: 'permission denied on docker.sock'
    })
    expect(parseDockerContainers('@missing')).toEqual({ state: 'missing' })
  })

  it('offers only images, containers and volumes nothing is using', () => {
    const plans = parseDockerCleanupScan(
      [
        '@ready',
        '@d\tImages\t1.2GB (40%)',
        '@d\tBuild Cache\t3.5GB',
        '@i\tsha256:aaaaaaaaaaaaaaaa\tnode\t22\t2\t1.1GB',
        '@i\tsha256:bbbbbbbbbbbbbbbb\tbusybox\t1.36\t0\t4.2MB',
        '@i\tsha256:cccccccccccccccc\t<none>\t<none>\t0\t300MB',
        '@i\tsha256:dddddddddddddddd\t$(reboot)\tlatest\t0\t1MB',
        '@c\t90f84a0c9638\tweb\tnginx:1.27\trunning\t2MB',
        '@c\t43b92ff52610\told-job\talpine:3.20\texited\t4.1kB',
        '@v\tpgdata\t1\t2GB',
        '@v\tscratch\t0\t512MB'
      ].join('\n')
    )

    const planned = Object.fromEntries(
      Object.entries(plans).map(([target, plan]) => [
        target,
        plan.items.map((item) => [item.label, item.bytes, item.preselected, item.action])
      ])
    )
    expect(planned).toEqual({
      'docker-images': [
        [
          'busybox:1.36',
          4_200_000,
          false,
          { kind: 'docker', args: ['image', 'rm', 'busybox:1.36'] }
        ],
        [
          'cccccccccccc',
          300_000_000,
          false,
          { kind: 'docker', args: ['image', 'rm', 'sha256:cccccccccccccccc'] }
        ]
      ],
      'docker-containers': [
        ['old-job', 4100, false, { kind: 'docker', args: ['container', 'rm', '43b92ff52610'] }]
      ],
      'docker-volumes': [
        ['scratch', 512_000_000, false, { kind: 'docker', args: ['volume', 'rm', 'scratch'] }]
      ],
      'docker-build-cache': [
        [
          'docker builder prune --all',
          3_500_000_000,
          true,
          { kind: 'docker', args: ['builder', 'prune', '--all', '--force'] }
        ]
      ]
    })
  })
})

describe('a cleanup scan', () => {
  it('never plans to remove the home folder, a top-level folder, or a relative path', () => {
    const plan = parsePathCleanupScan(
      'package-caches',
      [
        'H\t/home/brian',
        'I\t10\t1700000000\tnpm\t/home/brian',
        'I\t10\t1700000000\tnpm\t/home/brian/',
        'I\t10\t1700000000\tnpm\t/usr',
        'I\t10\t1700000000\tnpm\t/',
        'I\t10\t1700000000\tnpm\tcache',
        'I\t10\t1700000000\tnpm\t/home/brian/../other/.npm',
        'I\t2048\t1700000000\tnpm\t/home/brian/.npm/_cacache',
        'I\t4096\t0\tpnpm store\t/home/brian/.local/share/pnpm/store'
      ].join('\n')
    )

    expect(plan.items).toEqual([
      {
        id: 'package-caches:0',
        label: '/home/brian/.npm/_cacache',
        group: 'npm',
        bytes: 2048 * 1024,
        modifiedAt: 1_700_000_000_000,
        preselected: true,
        action: { kind: 'remove', path: '/home/brian/.npm/_cacache' }
      },
      {
        id: 'package-caches:1',
        label: '/home/brian/.local/share/pnpm/store',
        group: 'pnpm store',
        bytes: 4096 * 1024,
        modifiedAt: null,
        preselected: false,
        action: { kind: 'remove', path: '/home/brian/.local/share/pnpm/store' }
      }
    ])
  })

  it('empties the trash folder instead of removing it', () => {
    const emptied = parsePathCleanupScan(
      'trash',
      'H\t/Users/brian\nI\t900\t0\ttrash\t/Users/brian/.Trash\nE\t/Users/brian/.Trash'
    )
    const unlisted = parsePathCleanupScan(
      'trash',
      'H\t/Users/brian\nI\t900\t0\ttrash\t/Users/brian/.Trash'
    )

    expect(emptied.items.map((item) => item.action)).toEqual([
      { kind: 'empty', paths: ['/Users/brian/.Trash'] }
    ])
    expect(unlisted.items).toEqual([])
  })
})

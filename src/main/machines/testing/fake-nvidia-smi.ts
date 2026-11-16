/**
 * Recorded-style `nvidia-smi` output for machines with no GPU to test on. Rows follow what
 * `--format=csv,noheader,nounits` prints: `, ` between fields, MiB, W, MHz and °C without units,
 * and `[N/A]` where the card or driver has no figure.
 */
export type NvidiaSmiFixture = {
  /**
   * Rows of `index, uuid, utilization.gpu, memory.used, memory.total, temperature.gpu, power.draw,
   * power.limit, fan.speed, clocks.current.graphics, clocks.current.memory, mig.mode.current, name`.
   * Null for a driver that rejects that query, as one older than MIG does.
   */
  gpus: string[] | null
  /** Rows of `index, uuid, utilization.gpu, memory.used, memory.total, temperature.gpu, name`. */
  coreGpus: string[]
}

const A100 = 'NVIDIA A100-SXM4-80GB'

export const NVIDIA_SMI_FIXTURES = {
  /** A desktop card: it has a fan, and no MIG mode to report. */
  oneRtx4090: {
    gpus: [
      '0, GPU-3a9c6f6e-5d0b-7c1e-9b55-0a1f4d2c8e71, 87, 20412, 24564, 71, 312.45, 450.00, 64, 2520, 10501, [N/A], NVIDIA GeForce RTX 4090'
    ],
    coreGpus: [
      '0, GPU-3a9c6f6e-5d0b-7c1e-9b55-0a1f4d2c8e71, 87, 20412, 24564, 71, NVIDIA GeForce RTX 4090'
    ]
  },
  /** A desktop card beside a datacenter card split into MIG instances. */
  twoWithMig: {
    gpus: [
      '0, GPU-8f1d2c3b-4a5e-6f70-8192-a3b4c5d6e7f8, 34, 9120, 24576, 58, 187.20, 350.00, 47, 1905, 9751, [N/A], NVIDIA GeForce RTX 3090',
      `1, GPU-0b9a8c7d-6e5f-4a3b-2c1d-0e9f8a7b6c5d, [N/A], 13421, 81920, 44, 96.71, 400.00, [N/A], 1410, 1593, Enabled, ${A100}`
    ],
    coreGpus: [
      '0, GPU-8f1d2c3b-4a5e-6f70-8192-a3b4c5d6e7f8, 34, 9120, 24576, 58, NVIDIA GeForce RTX 3090',
      `1, GPU-0b9a8c7d-6e5f-4a3b-2c1d-0e9f8a7b6c5d, [N/A], 13421, 81920, 44, ${A100}`
    ]
  },
  /** A training server: four cards on one job, two on others, two idle. */
  eightA100: {
    gpus: [
      `0, GPU-11111111-aaaa-4bbb-8ccc-000000000000, 98, 71204, 81920, 77, 371.62, 400.00, [N/A], 1410, 1593, Disabled, ${A100}`,
      `1, GPU-11111111-aaaa-4bbb-8ccc-000000000001, 97, 71198, 81920, 76, 368.90, 400.00, [N/A], 1410, 1593, Disabled, ${A100}`,
      `2, GPU-11111111-aaaa-4bbb-8ccc-000000000002, 96, 70844, 81920, 75, 362.15, 400.00, [N/A], 1410, 1593, Disabled, ${A100}`,
      `3, GPU-11111111-aaaa-4bbb-8ccc-000000000003, 91, 69310, 81920, 73, 344.08, 400.00, [N/A], 1410, 1593, Disabled, ${A100}`,
      `4, GPU-11111111-aaaa-4bbb-8ccc-000000000004, 52, 40122, 81920, 58, 213.77, 400.00, [N/A], 1410, 1593, Disabled, ${A100}`,
      `5, GPU-11111111-aaaa-4bbb-8ccc-000000000005, 0, 7, 81920, 34, 56.21, 400.00, [N/A], 210, 405, Disabled, ${A100}`,
      `6, GPU-11111111-aaaa-4bbb-8ccc-000000000006, 99, 78455, 81920, 78, 381.40, 400.00, [N/A], 1410, 1593, Disabled, ${A100}`,
      `7, GPU-11111111-aaaa-4bbb-8ccc-000000000007, 0, 7, 81920, 33, 55.84, 400.00, [N/A], 210, 405, Disabled, ${A100}`
    ],
    coreGpus: []
  },
  /** A driver from before MIG: only the short field list is accepted. */
  oldDriverTwoK80: {
    gpus: null,
    coreGpus: [
      '0, GPU-5c2e9d41-7b3a-4f60-9e18-d2c4a6b8e0f1, 43, 8754, 11441, 62, Tesla K80',
      '1, GPU-5c2e9d41-7b3a-4f60-9e18-d2c4a6b8e0f2, 0, 0, 11441, 39, Tesla K80'
    ]
  }
} satisfies Record<string, NvidiaSmiFixture>

function heredoc(rows: readonly string[], filter = ''): string {
  return rows.length > 0
    ? `cat <<'SEAL_FAKE_ROWS'${filter}\n${rows.join('\n')}\nSEAL_FAKE_ROWS`
    : ':'
}

const LIVE_FILTER = ` | awk -F', ' -v OFS=', ' -v now="$(date +%s)" '{ if ($3 ~ /^[0-9]+$/ && $3 > 0) { $3 = $3 + (now + NR) % 5 - 2; if ($3 > 100) $3 = 100; if ($3 < 1) $3 = 1 } print }'`

/**
 * A `nvidia-smi` that answers the two queries Seal makes. The processes on the GPUs come from the
 * file `nvidia-smi.apps` beside it (`gpu_uuid, pid, used_memory, process_name` rows), so a test can
 * list processes it started; like the real tool, it stops listing one that has exited. A row
 * starting with `always:` is listed whether or not its pid exists here.
 *
 * `live` moves each utilization figure a little from one second to the next.
 */
export function fakeNvidiaSmiScript(
  fixture: NvidiaSmiFixture,
  options: { live?: boolean } = {}
): string {
  const full = fixture.gpus
    ? heredoc(fixture.gpus, options.live ? LIVE_FILTER : '')
    : `echo 'Field "mig.mode.current" is not a valid field to query.' >&2; exit 2`
  return `#!/bin/sh
case "$*" in
  *--query-gpu=*mig.mode.current*)
    ${full}
    ;;
  *--query-gpu=*)
    ${heredoc(fixture.coreGpus)}
    ;;
  *--query-compute-apps=*)
    apps="$(dirname "$0")/nvidia-smi.apps"
    [ -r "$apps" ] || exit 0
    while IFS= read -r row; do
      case "$row" in
        always:*) printf '%s\\n' "\${row#always:}" ;;
        *)
          pid=$(printf '%s\\n' "$row" | awk -F', ' '{ print $2 }')
          [ -d "/proc/$pid" ] && printf '%s\\n' "$row" ;;
      esac
    done <"$apps"
    exit 0 ;;
  *)
    echo "fake nvidia-smi: unsupported arguments: $*" >&2
    exit 2 ;;
esac
`
}

/** A `docker` that lists the given containers the way `docker ps -a --format` does, and nothing else. */
export function fakeDockerScript(containers: readonly { id: string; name: string }[]): string {
  const rows = containers.map(
    (container) => `${container.id}\t${container.name}\tseal/fixture:latest\tUp 2 hours`
  )
  return `#!/bin/sh
case "$1" in
  ps)
    ${heredoc(rows)}
    ;;
  *)
    exit 1 ;;
esac
`
}

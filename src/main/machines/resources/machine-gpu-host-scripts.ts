import { DOCKER_CONTAINER_LIST_FUNCTION } from './machine-docker-containers'

// The name comes last: it is the only field that could hold a comma.
const NVIDIA_FIELDS = [
  'index',
  'uuid',
  'utilization.gpu',
  'memory.used',
  'memory.total',
  'temperature.gpu',
  'power.draw',
  'power.limit',
  'fan.speed',
  'clocks.current.graphics',
  'clocks.current.memory',
  'mig.mode.current',
  'name'
]
// An old driver rejects the whole query over one field it does not know.
const NVIDIA_CORE_FIELDS = [
  'index',
  'uuid',
  'utilization.gpu',
  'memory.used',
  'memory.total',
  'temperature.gpu',
  'name'
]

/** One `nvidia-smi` call for every GPU; AMD and Apple Silicon report what their own tools give. */
export const MACHINE_GPU_READINGS_SCRIPT = `
seal_nvidia() {
  if command -v timeout >/dev/null 2>&1; then timeout 15 nvidia-smi "$@"; else nvidia-smi "$@"; fi
}
if command -v nvidia-smi >/dev/null 2>&1; then
  for seal_gpu_fields in ${NVIDIA_FIELDS.join(',')} ${NVIDIA_CORE_FIELDS.join(',')}; do
    if seal_gpu_rows=$(seal_nvidia --query-gpu="$seal_gpu_fields" --format=csv,noheader,nounits 2>/dev/null) && [ -n "$seal_gpu_rows" ]; then
      echo "@nvfields $seal_gpu_fields"
      printf '%s\\n' "$seal_gpu_rows" | sed 's/^/@nv\t/'
      break
    fi
  done
fi
if command -v rocm-smi >/dev/null 2>&1; then
  printf '@rocm\\t%s\\n' "$(rocm-smi --showproductname --showuse --showmeminfo vram --showtemp --showpower --showfan --json 2>/dev/null | tr -d '\\n')"
fi
if [ "$(uname -s)" = Darwin ] && [ "$(uname -m)" = arm64 ]; then
  ioreg -r -d 1 -w 0 -c IOAccelerator 2>/dev/null | grep -E '"(model|PerformanceStatistics)" =' | sed 's/^ */@apple\t/'
fi
`

/** Lists the processes on the GPUs, the container each runs in, and those containers' names. */
export const MACHINE_GPU_PROCESSES_SCRIPT = `
${DOCKER_CONTAINER_LIST_FUNCTION}
seal_gpu_pids=""
if command -v nvidia-smi >/dev/null 2>&1; then
  seal_gpu_apps=$(seal_nvidia --query-compute-apps=gpu_uuid,pid,used_memory,process_name --format=csv,noheader,nounits 2>/dev/null)
  if [ -n "$seal_gpu_apps" ]; then
    printf '%s\\n' "$seal_gpu_apps" | sed 's/^/@nvapp\t/'
    seal_gpu_pids=$(printf '%s\\n' "$seal_gpu_apps" | awk -F', ' '$2 ~ /^[0-9]+$/ { print $2 }' | sort -u | tr '\\n' ' ')
  fi
fi
seal_gpu_in_container=0
for seal_gpu_pid in $seal_gpu_pids; do
  seal_gpu_container=$(sed -n 's/.*\\([0-9a-f]\\{64\\}\\).*/\\1/p' "/proc/$seal_gpu_pid/cgroup" 2>/dev/null | head -n 1)
  if [ -n "$seal_gpu_container" ]; then
    printf '@gpuct\\t%s\\t%s\\n' "$seal_gpu_pid" "$seal_gpu_container"
    seal_gpu_in_container=1
  fi
done
if [ "$seal_gpu_in_container" = 1 ]; then seal_docker_list; fi
`

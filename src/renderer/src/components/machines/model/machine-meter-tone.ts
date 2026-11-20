/** `pressure` warns as a capacity fills; `neutral` is for a share that is fine at 100%, like GPU load. */
export type MachineMeterTone = 'pressure' | 'neutral'

/** Shows on a selected row too, which a track in the muted tone would not. */
export const MACHINE_METER_TRACK = 'bg-foreground/10'

export function machineMeterTone(percent: number | null, tone: MachineMeterTone): string {
  if (percent === null) {
    return 'bg-muted-foreground/30'
  }
  if (tone === 'neutral') {
    return 'bg-foreground/60'
  }
  return percent >= 90 ? 'bg-destructive' : percent >= 75 ? 'bg-status-warning' : 'bg-foreground/60'
}

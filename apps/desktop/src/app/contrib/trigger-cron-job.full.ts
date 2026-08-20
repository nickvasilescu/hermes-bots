import { triggerCronJob } from '@/hermes'

export function runSidebarCronJob(jobId: string, refresh: () => Promise<unknown>): void {
  void triggerCronJob(jobId)
    .then(() => refresh())
    .catch(() => undefined)
}

const INSTAGRAM_USERNAME = /^[a-z0-9._]{1,30}$/i

export const RADAR_AUTO_JOB = 'social-radar'
export const RADAR_AUTO_MAX_JOBS_PER_RUN = 3

export function isRadarAutoEnabled(value: string | undefined): boolean {
  return value === '1' || value?.toLowerCase() === 'true'
}

export function parseRadarUsernames(
  raw: string | undefined,
  ownHandles: Array<string | undefined>,
  maxProfiles: number
): string[] {
  const own = new Set(
    ownHandles
      .map((handle) => handle?.trim().replace(/^@/, '').toLowerCase())
      .filter((handle): handle is string => Boolean(handle))
  )
  const unique = new Set<string>()
  for (const candidate of raw?.split(/[\s,;]+/) ?? []) {
    const username = candidate.trim().replace(/^@/, '').toLowerCase()
    if (!INSTAGRAM_USERNAME.test(username) || own.has(username)) continue
    unique.add(username)
    if (unique.size >= Math.max(1, maxProfiles)) break
  }
  return [...unique]
}

/** Un reintento del workflow el mismo día debe reutilizar el job, no facturar otro Actor. */
export function radarDailyDedupeScope(now = new Date()): string {
  return `radar:${now.toISOString().slice(0, 10)}`
}

export function sortTenantsByOldestRun<T extends { id: string }>(
  tenants: T[],
  lastRunAtByTenant: ReadonlyMap<string, string>
): T[] {
  return [...tenants].sort((a, b) => {
    const aAt = lastRunAtByTenant.get(a.id)
    const bAt = lastRunAtByTenant.get(b.id)
    if (!aAt && !bAt) return a.id.localeCompare(b.id)
    if (!aAt) return -1
    if (!bAt) return 1
    return Date.parse(aAt) - Date.parse(bAt) || a.id.localeCompare(b.id)
  })
}

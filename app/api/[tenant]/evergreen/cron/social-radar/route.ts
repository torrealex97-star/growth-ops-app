import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { getTenantConfigWithFallback } from '@/lib/config'
import { recordSyncRun, SyncBusyError } from '@/lib/integrations/sync-runs'
import { createResearchJob, getApifyConfig } from '@/lib/social/apify'
import {
  isRadarAutoEnabled,
  parseRadarUsernames,
  radarDailyDedupeScope,
  RADAR_AUTO_JOB,
  RADAR_AUTO_MAX_JOBS_PER_RUN,
  sortTenantsByOldestRun,
} from '@/lib/social/radar-auto'

export const runtime = 'nodejs'
export const maxDuration = 60

type Tenant = { id: string; slug: string }
type Prepared = { tenant: Tenant; cfg: NonNullable<ReturnType<typeof getApifyConfig>>; usernames: string[] }

function svc(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

async function launchRadar(sb: SupabaseClient, prepared: Prepared) {
  const { tenant, cfg, usernames } = prepared
  return recordSyncRun(
    sb,
    {
      tenantId: tenant.id,
      provider: 'apify',
      job: RADAR_AUTO_JOB,
      trigger: 'cron',
      secrets: [cfg.token],
    },
    async () => {
      const result = await createResearchJob(
        sb,
        tenant.id,
        'instagram',
        { usernames, resultsLimit: cfg.resultsLimit, jobType: 'profile' },
        cfg,
        { dedupeScope: radarDailyDedupeScope() }
      )
      if (!result.ok) {
        if (result.code === 'limites') {
          return { deferred: true, reused: false, jobId: null, profiles: usernames.length }
        }
        throw Object.assign(new Error(result.error), { code: result.code })
      }
      return { ...result, deferred: false, profiles: usernames.length }
    },
    (result) => ({
      rowsWritten: null,
      detail: {
        jobId: result.jobId,
        profiles: result.profiles,
        asynchronous: true,
        deferred: result.deferred,
      },
    })
  )
}

// Comprobación diaria de Radar. El workflow puede invocar esta ruta sin coste: un Actor solo se
// lanza cuando LA SUBCUENTA ha activado APIFY_RADAR_AUTO_ENABLED y ha declarado perfiles. La flag
// se lee sin fallback de entorno para que una variable global nunca active gastos a todos los tenants.
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  const sb = svc()
  const [
    { data: tenants, error: tenantsError },
    { data: runs, error: runsError },
    { data: radarSettings, error: settingsError },
  ] = await Promise.all([
    sb.from('tenants').select('id, slug').eq('status', 'active'),
    sb
      .from('integration_sync_runs')
      .select('tenant_id, started_at')
      .eq('job', RADAR_AUTO_JOB)
      .order('started_at', { ascending: false })
      .limit(500),
    sb
      .from('integration_settings')
      .select('tenant_id, key, value')
      .in('key', ['APIFY_RADAR_AUTO_ENABLED', 'APIFY_RADAR_USERNAMES']),
  ])
  if (tenantsError || runsError || settingsError) {
    return NextResponse.json({ error: 'No se pudo preparar el Radar automático' }, { status: 500 })
  }

  const lastRunAt = new Map<string, string>()
  for (const run of runs || []) {
    if (!lastRunAt.has(run.tenant_id)) lastRunAt.set(run.tenant_id, run.started_at)
  }
  const localSettings = new Map<string, Record<string, string>>()
  for (const setting of radarSettings || []) {
    const current = localSettings.get(setting.tenant_id) || {}
    if (setting.value) current[setting.key] = setting.value
    localSettings.set(setting.tenant_id, current)
  }

  const prepared: Prepared[] = []
  let incomplete = 0
  let deferred = 0
  const orderedTenants = sortTenantsByOldestRun((tenants || []) as Tenant[], lastRunAt)
  const enabledTenants = orderedTenants.filter((tenant) =>
    isRadarAutoEnabled(localSettings.get(tenant.id)?.APIFY_RADAR_AUTO_ENABLED)
  )
  for (const tenant of enabledTenants) {
    if (prepared.length >= RADAR_AUTO_MAX_JOBS_PER_RUN) {
      deferred++
      continue
    }
    // La preferencia que autoriza gasto es exclusivamente tenant-local; token y actor sí pueden
    // usar el fallback global existente para conservar compatibilidad con instalaciones antiguas.
    const local = localSettings.get(tenant.id) || {}
    const env = await getTenantConfigWithFallback(tenant.id, true)
    const cfg = getApifyConfig(env)
    const usernames = cfg
      ? parseRadarUsernames(local.APIFY_RADAR_USERNAMES, [env.IG_HANDLE], cfg.maxProfilesPerRun)
      : []
    if (!cfg || !usernames.length) {
      incomplete++
      continue
    }
    prepared.push({ tenant, cfg, usernames })
  }

  const settled = await Promise.allSettled(prepared.map((item) => launchRadar(sb, item)))
  let launched = 0
  let reused = 0
  let failed = 0
  let busy = 0
  settled.forEach((result) => {
    if (result.status === 'fulfilled') {
      if (result.value.deferred) busy++
      else if (result.value.reused) reused++
      else launched++
      return
    }
    if (result.reason instanceof SyncBusyError) busy++
    else failed++
  })

  // Los jobs reutilizados se cuentan aparte. No se expone ningún tenant, token, runId o URL en
  // el response que queda registrado por GitHub Actions.
  return NextResponse.json(
    {
      ok: failed === 0,
      checked: (tenants || []).length,
      eligible: prepared.length,
      launched,
      reused,
      busy,
      failed,
      skipped: { disabled: orderedTenants.length - enabledTenants.length, incomplete, deferred },
      cap: RADAR_AUTO_MAX_JOBS_PER_RUN,
    },
    { status: failed > 0 ? 500 : 200 }
  )
}

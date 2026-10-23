import { NextRequest, NextResponse } from 'next/server'
import postgres from 'postgres'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { requireTenant } from '@/lib/auth/requireTenant'

export const runtime = 'nodejs'
export const maxDuration = 60

// Esta ruta ya NO programa nada. El cron de Meta vive SOLO en dos sitios previstos:
// GitHub Actions (`cron-meta.yml`, diario 03:00 UTC) y Vercel Cron (vercel.json: meta-ads
// 02:00, reminders 07:00 — Hobby admite 2). El job pg_cron `meta-sync-30min-<tenant>` que
// esta ruta creaba a demanda duplicaba esas ejecuciones cada 30 minutos, así que el POST
// que lo creaba se retiró y solo queda DELETE (desprogramar), por si algún job quedó vivo.
// Job names de pg_cron son globales en la BD (no por tenant): se retiran todos los que
// empiecen por el prefijo del módulo, sea cual sea la subcuenta que los creó.
const JOB_PREFIX = 'meta-sync-30min-'

// Auth: sesión admin/director de ESTA subcuenta (o super_admin) O Bearer CRON_SECRET.
async function autorizar(req: NextRequest, tenant: string) {
  const auth = req.headers.get('authorization')
  const bearerOk = !!process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`
  if (bearerOk) return null

  // requireTenant primero: sin esto, un admin/director de OTRA subcuenta podría tocar el
  // cron de esta subcuenta con solo conocer su slug.
  const t = await requireTenant(tenant)
  if ('error' in t) return t.error
  const cookieStore = await cookies()
  const authed = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll() {},
    },
  })
  const {
    data: { user },
  } = await authed.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  const { data: row } = await authed.from('users').select('roles(key)').eq('id', user.id).single()
  const role = (row?.roles as { key?: string } | null)?.key
  if (!t.isSuperAdmin && role !== 'admin' && role !== 'director') {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  }
  return null
}

export async function POST() {
  return NextResponse.json(
    {
      error:
        'La programación de 30 min se retiró: Meta se sincroniza por GitHub Actions (diario 03:00 UTC). Usa DELETE para retirar un job residual.',
    },
    { status: 405 }
  )
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const noAutorizado = await autorizar(req, tenant)
  if (noAutorizado) return noAutorizado

  if (!process.env.POSTGRES_URL) return NextResponse.json({ error: 'Falta POSTGRES_URL' }, { status: 500 })

  const sql = postgres(process.env.POSTGRES_URL, { ssl: 'require', max: 1, prepare: false, idle_timeout: 20 })
  const report: Record<string, unknown> = {}

  try {
    // El prefijo va parametrizado para que no haya interpolación de entrada en el SQL.
    const vivos = await sql<Array<{ jobname: string; schedule: string; active: boolean }>>`
      select jobname, schedule, active from cron.job where jobname like ${JOB_PREFIX + '%'} order by jobname
    `
    report.encontrados = vivos.map((j) => j.jobname)

    const retirados: string[] = []
    for (const j of vivos) {
      await sql.unsafe(`select cron.unschedule($1)`, [j.jobname])
      retirados.push(j.jobname)
    }
    report.retirados = retirados

    const quedan = await sql<Array<{ jobname: string }>>`
      select jobname from cron.job where jobname like ${JOB_PREFIX + '%'}
    `
    report.quedan = quedan.map((j) => j.jobname)
    await sql.end()

    return NextResponse.json({ ok: true, report })
  } catch (e) {
    await sql.end().catch(() => {})
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Error retirando el job pg_cron', report },
      { status: 500 }
    )
  }
}

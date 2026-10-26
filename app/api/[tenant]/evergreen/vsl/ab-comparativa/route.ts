import { NextResponse } from 'next/server'
import { sql } from '@/lib/vsl/db'
import { requirePantalla } from '@/lib/auth/requirePantalla'

export const dynamic = 'force-dynamic'

// Comparativa de hitos de visión (25/50/95 % y % medio) por vídeo de la subcuenta, con la MISMA
// definición que pinta el panel (`vsl/metrics/[slug]`) y que el SQL del runbook A/B
// (docs/VSL_AB_OCT26.md): play rate, hitos sobre `max_position` y promedio acotado a 1.
// Existe para que la comparativa semanal del experimento A/B no requiera lanzar SQL a mano:
// el panel VSL la muestra con un fetch autenticado. Escala a cualquier par de vídeos del
// tenant: el experimento de hoy usa `?slugs=` para limitar, la vista general no.
// NOTA: usa `postgres` directo (POSTGRES_URL), que bypassa RLS: el filtro `tenant_id` aquí
// debajo es la única barrera entre subcuentas (igual que en `vsl/metrics/[slug]`).
export async function GET(req: Request, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const { tenant } = await params
    const t = await requirePantalla(tenant, '/marketing/adquisicion/vsl')
    if ('error' in t) return t.error
    const tenantId = t.tenantId

    // `slugs` opcional (coma-separado) para comparar solo un par concreto; sin él, todos los
    // vídeos de la subcuenta. Se filtra SIEMPRE por tenant_id: el vídeo de otra cuenta
    // no existe para esta consulta.
    const slugs = new URL(req.url).searchParams.get('slugs')
    const listaSlugs = slugs
      ? slugs
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(0, 5)
      : null

    const filas = await sql`
      SELECT v.slug            AS slug,
             v.name            AS name,
             count(s.id) FILTER (WHERE s.max_position > 0)::int                        AS plays,
             count(s.id)::int                                                          AS impresiones,
             count(*) FILTER (WHERE s.duration > 0 AND s.max_position >= s.duration * 0.25)::int AS h25,
             count(*) FILTER (WHERE s.duration > 0 AND s.max_position >= s.duration * 0.50)::int AS h50,
             count(*) FILTER (WHERE s.duration > 0 AND s.max_position >= s.duration * 0.95)::int AS h95,
             avg(LEAST(s.max_position / NULLIF(s.duration, 0), 1))
               FILTER (WHERE s.max_position > 0)                                       AS avg_ratio
      FROM vsl_videos v
      LEFT JOIN vsl_sessions s ON s.video_id = v.id AND s.tenant_id = v.tenant_id
      WHERE v.tenant_id = ${tenantId}
        AND (${listaSlugs}::text[] IS NULL OR v.slug = ANY(${listaSlugs}::text[]))
      GROUP BY v.slug, v.name
      ORDER BY v.slug
    `

    const pct = (n: number, base: number) => (base > 0 ? Math.round((n / base) * 1000) / 10 : null)
    const videos = filas.map((f) => {
      const impresiones = Number(f.impresiones)
      const plays = Number(f.plays)
      // Un vídeo sin plays tiene hitos nulos (falta de muestra), no cero: «un hueco no es un cero».
      return {
        slug: f.slug,
        name: f.name,
        impresiones,
        plays,
        playRatePct: pct(plays, impresiones),
        visto25Pct: plays > 0 ? pct(Number(f.h25), plays) : null,
        visto50Pct: plays > 0 ? pct(Number(f.h50), plays) : null,
        visto95Pct: plays > 0 ? pct(Number(f.h95), plays) : null,
        pctMedio: f.avg_ratio == null ? null : Math.round(Number(f.avg_ratio) * 1000) / 10,
      }
    })

    return NextResponse.json({ generatedAt: new Date().toISOString(), videos })
  } catch (e) {
    console.error('[vsl/ab-comparativa]', e)
    return NextResponse.json({ error: 'Error al calcular la comparativa' }, { status: 500 })
  }
}

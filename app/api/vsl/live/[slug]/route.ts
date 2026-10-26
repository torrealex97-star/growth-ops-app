import { NextResponse } from 'next/server'
import { sql } from '@/lib/vsl/db'

export const dynamic = 'force-dynamic'

// Contador REAL de prueba social para un VSL:
//   - watching: sesiones con un latido en los últimos ~15s (viendo ahora mismo)
//   - watched : sesiones que han reproducido de verdad (max_position > 0)
// Pública (la llama el reproductor embebido). Ver PUBLIC_PATHS /api/vsl en middleware.
// Aislamiento de subcuenta (code review 26-oct): el slug de video NO es único global, solo
// dentro de la subcuenta. Contar por slug a secas mezclaba subcuentas distintas cuando dos
// videos comparten slug. El player manda ahora `?tenant=`, que siempre filtra; sin él se
// falla cerrado ante colisión (ceros, no la suma de otra cuenta) — mismo criterio que
// resolvePublicVsl.
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params
    const tenantQuery = new URL(req.url).searchParams.get('tenant')?.slice(0, 100) ?? null

    if (tenantQuery === null) {
      // Sin subcuenta explícita solo se siembra el contador si el slug tiene UN único dueño:
      // una colisión devolvería el dato de otra subcuenta, y devolver ceros es honesto.
      const [owners] = await sql`
        SELECT count(*)::int AS owners
        FROM (SELECT DISTINCT v.tenant_id FROM vsl_videos v WHERE v.slug = ${slug}) o
      `
      if ((Number(owners?.owners) || 0) > 1) {
        return NextResponse.json({ watching: 0, watched: 0 }, { headers: { 'Cache-Control': 'no-store' } })
      }
    }

    const [row] =
      tenantQuery === null
        ? await sql`
            SELECT
              count(*) FILTER (WHERE s.last_beat_at > now() - interval '15 seconds')::int AS watching,
              count(*) FILTER (WHERE s.max_position > 0)::int                              AS watched
            FROM vsl_sessions s
            JOIN vsl_videos v ON v.id = s.video_id
            WHERE v.slug = ${slug}
          `
        : await sql`
            SELECT
              count(*) FILTER (WHERE s.last_beat_at > now() - interval '15 seconds')::int AS watching,
              count(*) FILTER (WHERE s.max_position > 0)::int                              AS watched
            FROM vsl_sessions s
            JOIN vsl_videos v ON v.id = s.video_id
            JOIN tenants t ON t.id = v.tenant_id
            WHERE v.slug = ${slug}
              AND t.slug = ${tenantQuery}
          `

    return NextResponse.json(
      { watching: Number(row?.watching) || 0, watched: Number(row?.watched) || 0 },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (e) {
    console.error('[vsl/live]', e)
    return NextResponse.json({ watching: 0, watched: 0 }, { status: 200 })
  }
}

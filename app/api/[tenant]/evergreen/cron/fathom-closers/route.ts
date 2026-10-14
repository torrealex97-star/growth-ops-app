import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { esTablaInexistente, sincronizarConexionPersonal, type ConexionFathom } from '@/lib/fathom/conexion-personal'

export const runtime = 'nodejs'
export const maxDuration = 60

// Cron de FATHOM PERSONAL: recorre las conexiones de los closers que han pegado su clave y trae sus
// reuniones recientes por la ingesta canónica. Reparte el presupuesto entre las conexiones empezando por
// la que lleva más tiempo sin sincronizar, para que ninguna se muera de hambre si hay muchas. Un corte
// por presupuesto no es un fallo: lo hecho queda guardado (idempotente) y la siguiente pasada continúa.
const PRESUPUESTO_MS = 45_000
const POR_CONEXION_MS = 12_000

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }
  const inicio = Date.now()
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await sb
    .from('user_fathom_connections')
    .select('id,tenant_id,user_id,api_key,status,last_sync_at,last_error,meetings_seen')
    .order('last_sync_at', { ascending: true, nullsFirst: true })
    .limit(50)
  if (error) {
    // Migración sin aplicar: no hay conexiones que sincronizar, y fallar cada 30 min solo ensuciaría Actions.
    if (esTablaInexistente(error.message))
      return NextResponse.json({ ok: true, conexiones: 0, nota: 'tabla pendiente' })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const conexiones = (data ?? []) as ConexionFathom[]
  const resultados: Array<Record<string, unknown>> = []
  for (const c of conexiones) {
    if (Date.now() - inicio > PRESUPUESTO_MS) {
      resultados.push({ conexion: c.id.slice(0, 8), omitida: true, motivo: 'presupuesto agotado' })
      continue
    }
    const r = await sincronizarConexionPersonal(sb, c, {
      paginas: 1,
      porPagina: 25,
      deadlineMs: Math.min(Date.now() + POR_CONEXION_MS, inicio + PRESUPUESTO_MS),
    })
    resultados.push({ conexion: c.id.slice(0, 8), ...r })
  }
  return NextResponse.json({ ok: true, conexiones: conexiones.length, resultados })
}

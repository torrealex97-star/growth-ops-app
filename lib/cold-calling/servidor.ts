import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { calendario, type Lanzamiento } from '@/lib/launch/lanzamientos'
import { ErrorColdCalling } from './policy'

// Piezas comunes de las rutas de cold calling.

export function servicio(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

/**
 * Qué lanzamiento se trabaja: el pedido (si es de esta subcuenta y ya se abrió), el abierto o, si no
 * hay ninguno abierto, el último que lo estuvo. Los programados no tienen leads: no se ofrecen.
 */
export async function resolverLanzamiento(
  sb: SupabaseClient,
  tenantId: string,
  pedido: string | null
): Promise<{ lanzamientos: Lanzamiento[]; launch: Lanzamiento | null }> {
  const lanzamientos = (await calendario(sb, tenantId)).filter((l) => l.estado !== 'programado')
  const launch =
    (pedido ? lanzamientos.find((l) => l.id === pedido) : null) ??
    lanzamientos.find((l) => l.abierto) ??
    lanzamientos[0] ??
    null
  return { lanzamientos, launch }
}

/** Errores de negocio → su código con el mensaje; el resto → 500 sin detalles internos. */
export function responderError(e: unknown, donde: string): NextResponse {
  if (e instanceof ErrorColdCalling) return NextResponse.json({ error: e.message }, { status: e.status })
  console.error(`[cold-calling/${donde}]`, e instanceof Error ? e.message : e)
  return NextResponse.json({ error: 'No se pudo completar la operación. Inténtalo de nuevo.' }, { status: 500 })
}

export async function leerJson<T>(req: Request): Promise<T | null> {
  try {
    const body = await req.json()
    return body && typeof body === 'object' && !Array.isArray(body) ? (body as T) : null
  } catch {
    return null
  }
}

import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth/requireTenant'
import { getTenantConfigWithFallback } from '@/lib/config'
import { limitar } from '@/lib/security/rate-limit'
import { BUCKET_CARRUSELES, rutaValida } from '@/lib/carruseles/almacen'
import {
  MAX_EJEMPLOS_ANALISIS,
  analizarEjemplos,
  conEjemplo,
  conGuia,
  descargarEjemplo,
  esTipoEjemplo,
  sinEjemplo,
} from '@/lib/carruseles/ejemplos'
import { actualizarEjemplos, leerEjemplos } from '@/lib/carruseles/ejemplos-store'

export const runtime = 'nodejs'
export const maxDuration = 60

const PUEDEN_EDITAR = ['admin', 'director', 'manager']

const error = (mensaje: string, status = 400) => NextResponse.json({ error: mensaje }, { status })

// Ejemplos de historias y carruseles del tenant + su guía de estilo. Ver lib/carruseles/ejemplos.ts.
//   GET                              → ejemplos y guías
//   POST {accion:'registrar', tipo, path, name} → registra un ejemplo ya subido (ver /upload-url)
//   POST json {accion:'analizar', tipo} → analiza con IA y guarda la guía
//   PUT  {tipo, guia}                → guarda la guía editada a mano
//   DELETE ?id=                      → quita un ejemplo
export async function GET(_req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const t = await requireTenant(tenant)
  if ('error' in t) return t.error
  try {
    return NextResponse.json({ ...(await leerEjemplos(t.tenantId)), puedeEditar: PUEDEN_EDITAR.includes(t.role ?? '') })
  } catch (e) {
    return error(e instanceof Error ? e.message : 'Error', 500)
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const t = await requireTenant(tenant)
  if ('error' in t) return t.error
  if (!PUEDEN_EDITAR.includes(t.role ?? '')) return error('Solo liderazgo puede gestionar los ejemplos', 403)

  try {
    const body = (await req.json().catch(() => ({}))) as {
      accion?: string
      tipo?: unknown
      path?: unknown
      name?: unknown
    }
    if (!esTipoEjemplo(body.tipo)) return error('Acción no válida')
    const tipo = body.tipo

    // El archivo ya lo subió el navegador directo al almacén (ver /upload-url): aquí solo se registra.
    if (body.accion === 'registrar') {
      if (!rutaValida(body.path, tenant, 'ejemplos')) return error('La ruta no es válida')
      const url = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
        auth: { persistSession: false },
      })
        .storage.from(BUCKET_CARRUSELES)
        .getPublicUrl(body.path).data.publicUrl
      const nuevo = {
        id: crypto.randomUUID(),
        url,
        name: typeof body.name === 'string' ? body.name.slice(0, 120) : 'ejemplo',
        tipo,
        addedAt: new Date().toISOString(),
      }
      return NextResponse.json(await actualizarEjemplos(t.tenantId, (a) => conEjemplo(a, nuevo)))
    }
    if (body.accion !== 'analizar') return error('Acción no válida')
    const lim = limitar(`analizar-ejemplos:${t.tenantId}`, 10, 10 * 60_000)
    if (!lim.ok) return error(`Demasiados análisis seguidos. Espera ${lim.reintentarEnSeg} s.`, 429)

    const { ejemplos } = await leerEjemplos(t.tenantId)
    const elegidos = ejemplos.filter((e) => e.tipo === tipo).slice(-MAX_EJEMPLOS_ANALISIS)
    if (!elegidos.length) return error('Sube primero algún ejemplo de este tipo')
    const imagenes = (await Promise.all(elegidos.map((e) => descargarEjemplo(e.url)))).filter((i) => i !== null)
    if (!imagenes.length) return error('No se pudo leer ningún ejemplo (formato o tamaño no válidos)')
    const guia = await analizarEjemplos(await getTenantConfigWithFallback(t.tenantId, true), tipo, imagenes)
    return NextResponse.json(await actualizarEjemplos(t.tenantId, (a) => conGuia(a, tipo, guia)))
  } catch (e) {
    return error(e instanceof Error ? e.message : 'No se pudo completar la acción', 500)
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const t = await requireTenant(tenant)
  if ('error' in t) return t.error
  if (!PUEDEN_EDITAR.includes(t.role ?? '')) return error('Solo liderazgo puede gestionar los ejemplos', 403)
  const body = (await req.json().catch(() => ({}))) as { tipo?: unknown; guia?: unknown }
  if (!esTipoEjemplo(body.tipo) || typeof body.guia !== 'string') return error('Faltan datos')
  const { tipo, guia } = body as { tipo: 'historias' | 'carrusel'; guia: string }
  try {
    return NextResponse.json(await actualizarEjemplos(t.tenantId, (a) => conGuia(a, tipo, guia)))
  } catch (e) {
    return error(e instanceof Error ? e.message : 'No se pudo guardar', 500)
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const t = await requireTenant(tenant)
  if ('error' in t) return t.error
  if (!PUEDEN_EDITAR.includes(t.role ?? '')) return error('Solo liderazgo puede gestionar los ejemplos', 403)
  const id = req.nextUrl.searchParams.get('id') ?? ''
  if (!id) return error('Falta el ejemplo')
  try {
    return NextResponse.json(await actualizarEjemplos(t.tenantId, (a) => sinEjemplo(a, id)))
  } catch (e) {
    return error(e instanceof Error ? e.message : 'No se pudo quitar', 500)
  }
}

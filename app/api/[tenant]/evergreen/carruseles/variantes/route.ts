import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth/requireTenant'
import { getTenantConfig, getTenantConfigWithFallback } from '@/lib/config'
import { getCarruselUser } from '@/lib/carruseles/auth'
import { getProject } from '@/lib/carruseles/store'
import { limitar } from '@/lib/security/rate-limit'
import { generarTexto } from '@/lib/launch/generar-pieza'
import { leerSpecDeHtml } from '@/lib/carruseles/historias/pedidos'
import { textoDeHistoria } from '@/lib/carruseles/historias/revision'
import {
  MODOS_VARIANTE,
  construirPromptVariantes,
  leerVariantes,
  type ModoVariante,
} from '@/lib/carruseles/historias/variantes'

export const runtime = 'nodejs'
export const maxDuration = 60

// POST { projectId, slideId, modo: 'ganchos'|'otra'|'corta' } → 3 propuestas de texto para UNA historia. No guarda nada:
// la persona elige y el editor recompone la historia (sin IA).
export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const t = await requireTenant(tenant)
  if ('error' in t) return t.error
  if (!(await getCarruselUser())) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const body = (await req.json().catch(() => ({}))) as { projectId?: unknown; slideId?: unknown; modo?: unknown }
  if (
    typeof body.projectId !== 'string' ||
    typeof body.slideId !== 'string' ||
    !(MODOS_VARIANTE as readonly unknown[]).includes(body.modo)
  )
    return NextResponse.json({ error: 'Faltan datos' }, { status: 400 })
  const modo = body.modo as ModoVariante

  const lim = limitar(`variantes:${t.tenantId}`, 40, 10 * 60_000)
  if (!lim.ok)
    return NextResponse.json(
      { error: `Demasiadas peticiones seguidas. Espera ${lim.reintentarEnSeg} s.` },
      { status: 429 }
    )

  try {
    const project = await getProject(t.tenantId, body.projectId)
    const indice = project?.slides.findIndex((s) => s.id === body.slideId) ?? -1
    if (!project || indice < 0) return NextResponse.json({ error: 'Historia no encontrada' }, { status: 404 })
    const previa = leerSpecDeHtml(project.slides[indice].html)
    if (!previa)
      return NextResponse.json({ error: 'Esta historia es antigua: pídele el cambio al asistente' }, { status: 400 })

    const resto = project.slides
      .filter((_, i) => i !== indice)
      .map((s) => leerSpecDeHtml(s.html))
      .map((p) => (p ? textoDeHistoria(p.spec) : ''))
      .filter(Boolean)
      .slice(0, 8)
    const propia = await getTenantConfig(t.tenantId, true)
    const prompt = construirPromptVariantes({
      modo,
      spec: previa.spec,
      resto,
      contexto: propia.IG_BUSINESS_CONTEXT,
      posicion: indice + 1,
      total: project.slides.length,
    })
    const r = await generarTexto(await getTenantConfigWithFallback(t.tenantId, true), prompt)
    const opciones = leerVariantes(r.texto)
    if (!opciones.length)
      return NextResponse.json({ error: 'La IA no devolvió propuestas válidas. Inténtalo de nuevo.' }, { status: 502 })
    return NextResponse.json({ opciones, motor: r.motor })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'No se pudieron generar variantes' },
      { status: 500 }
    )
  }
}

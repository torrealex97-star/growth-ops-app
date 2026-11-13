import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getTenantConfig } from '@/lib/config'
import { authorizeForms } from '@/lib/forms/admin'
import {
  FUENTES,
  FUENTE_INFO,
  fuenteConectada,
  importarFormulario,
  listarImportables,
  type Fuente,
} from '@/lib/forms/importar'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

// IMPORTAR UN FORMULARIO DE TYPEFORM / CALENDLY / GOHIGHLEVEL.
//
// GET            → qué fuentes tiene conectadas la subcuenta.
// GET ?source=x  → qué se puede importar de esa fuente (formularios o tipos de evento).
// POST           → convierte uno en una PROPUESTA de formulario (no lo crea: eso es POST /forms).
//
// La credencial es SOLO la de la subcuenta (`getTenantConfig`, sin relevo a las variables globales): con el
// relevo, una subcuenta sin token propio listaría los formularios de la cuenta global. Solo lectura en el
// proveedor.

const esFuente = (v: unknown): v is Fuente => typeof v === 'string' && (FUENTES as readonly string[]).includes(v)

export async function GET(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const g = await authorizeForms(tenant, true)
  if ('error' in g) return g.error
  const cfg = await getTenantConfig(g.auth.tenantId)

  const source = req.nextUrl.searchParams.get('source')
  if (!source) {
    return NextResponse.json({
      fuentes: FUENTES.map((id) => ({
        id,
        nombre: FUENTE_INFO[id].nombre,
        elemento: FUENTE_INFO[id].elemento,
        nota: FUENTE_INFO[id].nota,
        conectada: fuenteConectada(id, cfg),
      })),
    })
  }
  if (!esFuente(source)) return NextResponse.json({ error: 'Origen no válido' }, { status: 400 })
  if (!fuenteConectada(source, cfg)) {
    return NextResponse.json(
      { error: `Conecta ${FUENTE_INFO[source].nombre} en Ajustes › Integraciones para importar desde ahí.` },
      { status: 409 }
    )
  }
  try {
    return NextResponse.json({ items: await listarImportables(source, cfg) })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'No se pudo leer el origen' }, { status: 502 })
  }
}

const body = z.object({ source: z.enum(FUENTES), id: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/) })

export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const g = await authorizeForms(tenant, true)
  if ('error' in g) return g.error
  const parsed = body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Petición no válida' }, { status: 400 })
  const { source, id } = parsed.data
  const cfg = await getTenantConfig(g.auth.tenantId)
  if (!fuenteConectada(source, cfg)) {
    return NextResponse.json(
      { error: `Conecta ${FUENTE_INFO[source].nombre} en Ajustes › Integraciones para importar desde ahí.` },
      { status: 409 }
    )
  }
  try {
    return NextResponse.json(await importarFormulario(source, id, cfg))
  } catch (e) {
    // 422: se leyó el origen pero de ahí no sale un formulario (p. ej. GHL sin respuestas).
    return NextResponse.json({ error: e instanceof Error ? e.message : 'No se pudo importar' }, { status: 422 })
  }
}

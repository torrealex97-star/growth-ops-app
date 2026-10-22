import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireTenant } from '@/lib/auth/requireTenant'
import { ROLES_GESTION } from '@/lib/conversaciones/acciones'
import { depsReales } from '@/lib/conversaciones/deps-reales'
import { enviarComoPersona } from '@/lib/conversaciones/envio'
import { limitar } from '@/lib/security/rate-limit'

export const runtime = 'nodejs'
export const maxDuration = 30

// Responde a un lead desde la bandeja. Efecto externo IRREVERSIBLE (un DM real): rol de gestión, conversación
// de ESTA subcuenta, contacto y canal salen de la base de datos (nunca del cliente), ventana abierta y tope de
// ritmo por usuario.
export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string; id: string }> }) {
  const { tenant, id } = await params
  const sesion = await requireTenant(tenant)
  if ('error' in sesion) return sesion.error
  const rol = sesion.isSuperAdmin ? 'admin' : (sesion.role ?? '')
  if (!(ROLES_GESTION as readonly string[]).includes(rol))
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Conversación no válida' }, { status: 400 })
  if (!limitar(`conv:resp:${sesion.userId}`, 30, 60_000).ok)
    return NextResponse.json({ error: 'Demasiados envíos seguidos. Espera un minuto.' }, { status: 429 })

  const cuerpo = (await req.json().catch(() => null)) as { texto?: unknown } | null
  const texto = typeof cuerpo?.texto === 'string' ? cuerpo.texto : ''
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const deps = await depsReales(sesion.tenantId)
  const r = await enviarComoPersona(
    sb,
    sesion.tenantId,
    id,
    texto,
    sesion.userId,
    { enviar: deps.enviar },
    { tipo: 'respuesta' }
  )
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json({ ok: true, messageId: r.messageId })
}

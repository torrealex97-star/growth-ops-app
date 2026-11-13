import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { tenantAiEnv } from '@/lib/ai/provider'
import { authorizeForms } from '@/lib/forms/admin'
import { MAX_CARACTERES_MENSAJE, MAX_MENSAJES, turnoCreador } from '@/lib/forms/ai-builder'
import { formConfigSchema } from '@/lib/forms/schema'
import { FORM_AUDIENCES, FORM_CATEGORIES, type FormConfig } from '@/lib/forms/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Tope Free Tier (docs/FREE_TIER_OPERATIONS.md): 60 s. El reintento de corrección solo se hace si cabe
// (ver PRESUPUESTO_REINTENTO_MS en lib/forms/ai-builder.ts).
export const maxDuration = 60

// UN TURNO DE «CREAR CON IA». No escribe en la base de datos: devuelve preguntas de aclaración o una
// PROPUESTA de formulario ya saneada. El formulario se crea (en borrador) con POST /forms cuando la persona
// lo confirma. Solo roles que pueden crear formularios; el motor de IA es el de la subcuenta.

const body = z.object({
  messages: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(MAX_CARACTERES_MENSAJE) }))
    .min(1)
    .max(MAX_MENSAJES),
  // Propuesta vigente, cuando se piden cambios sobre ella. Se revalida: viene del navegador.
  current: z
    .object({
      name: z.string().trim().min(1).max(160),
      category: z.enum(FORM_CATEGORIES),
      audience: z.enum(FORM_AUDIENCES),
      config: formConfigSchema,
    })
    .nullish(),
})

export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const g = await authorizeForms(tenant, true)
  if ('error' in g) return g.error

  const parsed = body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Petición no válida' }, { status: 400 })
  const { messages, current } = parsed.data
  if (messages[messages.length - 1].role !== 'user' || !messages[messages.length - 1].content.trim()) {
    return NextResponse.json({ error: 'Escribe qué formulario quieres crear' }, { status: 400 })
  }

  try {
    const respuesta = await turnoCreador(
      messages,
      current ? { ...current, config: current.config as FormConfig } : null,
      await tenantAiEnv(g.auth.tenantId)
    )
    return NextResponse.json(respuesta)
  } catch (e) {
    // El mensaje ya es legible (sin motor conectado, formato no válido tras el reintento…).
    return NextResponse.json({ error: e instanceof Error ? e.message : 'La IA no ha respondido' }, { status: 502 })
  }
}

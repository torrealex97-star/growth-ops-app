import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveFields, type Qualification } from '@/lib/launch/calidad'
import { analizarVoz, ideasDeContenido, type Fragmento } from './voz-cliente'

// Lectura de la voz del cliente. Todo con `tenant_id` explícito (service-role: RLS no protege) y
// proyección estricta. Fuentes:
//   · Formulario previo a la llamada  → contacts.qualification (frenos, motivo, lo que esperan)
//   · Llamada de ventas               → appointments.ai_analysis.objections
//   · Feedback / onboarding           → form_responses de formularios para alumnos
// «Cliente» = contacto con una venta activa que no es una reserva abierta (docs/MONEY.md, D8): sus
// objeciones de la llamada de ventas son lo que temían ANTES de comprar.

const MAX_CONTACTOS = 1500
const MAX_CITAS = 1500
const MAX_RESPUESTAS = 1500
const TROZO = 150

const PREGUNTA_ABIERTA = /motivo|por que|razon|dolor|problema|reto|miedo|duda|frena|impide|objetivo|esperas|conseguir/

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

const trozos = <T>(xs: T[], n: number): T[][] => {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n))
  return out
}

/** Textos libres de una qualification: frenos, lo que esperan y las preguntas abiertas habituales. */
export function textosDeQualification(q: Qualification | null): string[] {
  if (!q) return []
  const f = resolveFields(q)
  const textos = [f.frenos, f.que_piden].filter((x): x is string => Boolean(x && x.trim()))
  for (const r of q.respuestas ?? []) {
    if (typeof r?.q !== 'string' || typeof r?.a !== 'string') continue
    if (r.a.trim().length >= 12 && PREGUNTA_ABIERTA.test(norm(r.q))) textos.push(r.a)
  }
  return [...new Set(textos)]
}

/** Respuestas de texto libre de un formulario (valores string con cuerpo suficiente). */
export function textosDeRespuesta(answers: unknown): string[] {
  if (!answers || typeof answers !== 'object') return []
  return Object.values(answers as Record<string, unknown>)
    .filter((v): v is string => typeof v === 'string' && v.trim().length >= 15)
    .map((v) => v.trim())
}

export async function leerVozCliente(
  sb: SupabaseClient,
  tenantId: string,
  opciones: { dias: number; conCitas: boolean }
) {
  const desde = new Date(Date.now() - opciones.dias * 86_400_000).toISOString()
  const fragmentos: Fragmento[] = []
  const errores: string[] = []

  // Quién es cliente: venta activa que no sea una reserva abierta.
  const clientes = new Set<string>()
  {
    const { data, error } = await sb
      .from('sales')
      .select('contact_id, reservation_completed_at, payment_plans(method)')
      .eq('tenant_id', tenantId)
      .eq('status', 'active')
      .limit(5000)
    if (error) errores.push('ventas')
    for (const v of (data ?? []) as unknown as {
      contact_id: string | null
      reservation_completed_at: string | null
      payment_plans: { method: string | null } | { method: string | null }[] | null
    }[]) {
      const plan = Array.isArray(v.payment_plans) ? v.payment_plans[0] : v.payment_plans
      if (!v.contact_id) continue
      if (plan?.method === 'reserva' && !v.reservation_completed_at) continue
      clientes.add(v.contact_id)
    }
  }

  // Formulario previo (potenciales o, si ya compraron, clientes).
  {
    const { data, error } = await sb
      .from('contacts')
      .select('id, qualification')
      .eq('tenant_id', tenantId)
      .not('qualification', 'is', null)
      .gte('created_at', desde)
      .order('created_at', { ascending: false })
      .limit(MAX_CONTACTOS)
    if (error) errores.push('formularios')
    for (const c of (data ?? []) as { id: string; qualification: Qualification | null }[]) {
      for (const texto of textosDeQualification(c.qualification))
        fragmentos.push({
          persona: c.id,
          grupo: clientes.has(c.id) ? 'clientes' : 'potenciales',
          origen: 'formulario_previo',
          texto,
        })
    }
  }

  // Objeciones de la llamada de ventas.
  {
    const { data, error } = await sb
      .from('appointments')
      .select('id, contact_id, objeciones:ai_analysis->objections')
      .eq('tenant_id', tenantId)
      .not('ai_analysis', 'is', null)
      .gte('created_at', desde)
      .limit(MAX_CITAS)
    if (error) errores.push('llamadas')
    for (const a of (data ?? []) as unknown as { id: string; contact_id: string | null; objeciones: unknown }[]) {
      if (!Array.isArray(a.objeciones)) continue
      const persona = a.contact_id ?? a.id
      for (const o of a.objeciones)
        if (typeof o === 'string' && o.trim())
          fragmentos.push({
            persona,
            grupo: a.contact_id && clientes.has(a.contact_id) ? 'clientes' : 'potenciales',
            origen: 'llamada_ventas',
            texto: o,
          })
    }
  }

  // Feedback y onboarding: formularios para alumnos (clientes) y de captación (potenciales).
  {
    const { data: formularios, error: eF } = await sb.from('forms').select('id, audience').eq('tenant_id', tenantId)
    if (eF) errores.push('formularios_alumnos')
    const audiencia = new Map(
      ((formularios ?? []) as { id: string; audience: string }[]).map((f) => [f.id, f.audience])
    )
    const ids = [...audiencia.keys()]
    for (const grupoIds of trozos(ids, TROZO)) {
      const { data, error } = await sb
        .from('form_responses')
        .select('id, form_id, contact_id, answers')
        .eq('tenant_id', tenantId)
        .in('form_id', grupoIds)
        .gte('created_at', desde)
        .limit(MAX_RESPUESTAS)
      if (error) {
        errores.push('respuestas')
        break
      }
      for (const r of (data ?? []) as { id: string; form_id: string; contact_id: string | null; answers: unknown }[]) {
        const aud = audiencia.get(r.form_id)
        for (const texto of textosDeRespuesta(r.answers))
          fragmentos.push({
            persona: r.contact_id ?? r.id,
            grupo: aud === 'alumnos' ? 'clientes' : 'potenciales',
            origen: aud === 'alumnos' ? 'feedback' : 'formulario_previo',
            texto,
          })
      }
    }
  }

  const voz = analizarVoz(fragmentos, { conCitas: opciones.conCitas })
  return { dias: opciones.dias, voz, ideas: ideasDeContenido(voz), citasVisibles: opciones.conCitas, errores }
}

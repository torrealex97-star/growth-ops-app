import type { SupabaseClient } from '@supabase/supabase-js'
import { isAttended } from '@/lib/appointments/status'
import { esReservaAbierta } from '@/lib/metrics/agregados'
import {
  computeAdQuality,
  resolveFields,
  qualityScore,
  qualityScoreJunio,
  UMBRAL_LEAD_BUENO,
  type AdQuality,
  type LeadForQuality,
  type Qualification,
} from './calidad'
import {
  construirAcciones,
  construirEmbudo,
  datosQueFaltan,
  distribucion,
  frasesRepetidas,
  veredictoAnuncio,
  type FuentesLanzamiento,
} from './informe'

// Lectura del informe de un lanzamiento. Todo con `tenant_id` explícito (cliente service-role: RLS
// no protege). Proyección estricta, sin PII en la salida: solo agregados y frases anonimizadas.
//
// Cruce con agendas y ventas: se cuentan los contactos del lanzamiento con una cita / una venta
// CREADA desde el primer registro del lanzamiento (no se atribuye una compra anterior al evento).
// Una reserva abierta no es venta (docs/MONEY.md, D8).

const MAX_FILAS = 5000
const TROZO = 150
const CANCELADAS = new Set(['cancelled', 'cancelled_admin', 'rescheduled'])

type FilaLead = {
  id: string
  created_at: string
  confirmed_at: string | null
  invitado_at: string | null
  utm: Record<string, string> | null
  contact_id: string
  contacts: { qualification: Record<string, unknown> | null } | null
}

const trozos = <T>(xs: T[], n: number): T[][] => {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n))
  return out
}

export async function leerInforme(
  sb: SupabaseClient,
  tenantId: string,
  launchId: string,
  cfg: Record<string, string | undefined>
) {
  const { data: lanz } = await sb
    .from('launches')
    .select('id, label, fecha')
    .eq('tenant_id', tenantId)
    .eq('id', launchId)
    .maybeSingle()
  if (!lanz) throw new Error('Lanzamiento no encontrado')

  const { count: totalReal, error: errCount } = await sb
    .from('contact_launches')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('launch_id', launchId)
  if (errCount) throw new Error(`No se pudieron contar los registros: ${errCount.message}`)

  const { data: filas, error } = await sb
    .from('contact_launches')
    .select('id, created_at, confirmed_at, invitado_at, utm, contact_id, contacts!inner(qualification)')
    .eq('tenant_id', tenantId)
    .eq('launch_id', launchId)
    .order('created_at', { ascending: true })
    .limit(MAX_FILAS)
  if (error) throw new Error(`No se pudieron leer los registros: ${error.message}`)
  const lista = (filas ?? []) as unknown as FilaLead[]

  const contactIds = [...new Set(lista.map((f) => f.contact_id))]
  const desde = lista[0]?.created_at ?? null

  // Agendas: contactos con al menos una cita no cancelada; asistencia: alguna cita con asistencia.
  const conCita = new Set<string>()
  const asistieron = new Set<string>()
  const conVenta = new Set<string>()
  let agendasLeidas = true
  let ventasLeidas = true
  if (desde && contactIds.length) {
    for (const ids of trozos(contactIds, TROZO)) {
      const { data: citas, error: eC } = await sb
        .from('appointments')
        .select('contact_id, status')
        .eq('tenant_id', tenantId)
        .in('contact_id', ids)
        .gte('created_at', desde)
      if (eC) {
        agendasLeidas = false
        break
      }
      for (const c of (citas ?? []) as { contact_id: string; status: string }[]) {
        if (CANCELADAS.has(c.status)) continue
        conCita.add(c.contact_id)
        if (isAttended(c.status)) asistieron.add(c.contact_id)
      }
    }
    for (const ids of trozos(contactIds, TROZO)) {
      const { data: ventas, error: eV } = await sb
        .from('sales')
        .select('contact_id, status, reservation_completed_at, payment_plans(method)')
        .eq('tenant_id', tenantId)
        .eq('status', 'active')
        .in('contact_id', ids)
        .gte('created_at', desde)
      if (eV) {
        ventasLeidas = false
        break
      }
      for (const v of (ventas ?? []) as unknown as {
        contact_id: string
        reservation_completed_at: string | null
        payment_plans: { method: string | null } | { method: string | null }[] | null
      }[]) {
        const plan = Array.isArray(v.payment_plans) ? v.payment_plans[0] : v.payment_plans
        if (
          esReservaAbierta({
            payment_plan_method: plan?.method ?? null,
            reservation_completed_at: v.reservation_completed_at,
          })
        )
          continue
        conVenta.add(v.contact_id)
      }
    }
  }

  const leads: LeadForQuality[] = []
  const frenos: string[] = []
  const piden: string[] = []
  let confirmados = 0
  let invitados = 0
  for (const f of lista) {
    const fields = resolveFields((f.contacts?.qualification ?? null) as Qualification | null)
    if (f.confirmed_at) confirmados += 1
    if (f.invitado_at) invitados += 1
    if (fields.frenos) frenos.push(fields.frenos)
    if (fields.que_piden) piden.push(fields.que_piden)
    leads.push({
      id: f.id,
      anuncio: f.utm?.utm_content ?? null,
      campana: f.utm?.utm_campaign ?? null,
      fields,
      quality: qualityScore(fields),
      qualityJunio: qualityScoreJunio(fields),
      citas: conCita.has(f.contact_id) ? 1 : 0,
      ventas: conVenta.has(f.contact_id) ? 1 : 0,
      confirmado: Boolean(f.confirmed_at),
    })
  }

  const conEncuesta = leads.filter((l) => l.quality !== null)
  const avg = conEncuesta.length
    ? conEncuesta.reduce((a, l) => a + (l.quality as number), 0) / conEncuesta.length
    : null
  const pctBuenos = conEncuesta.length
    ? (conEncuesta.filter((l) => (l.quality as number) >= UMBRAL_LEAD_BUENO).length / conEncuesta.length) * 100
    : null
  const ref = { avgQuality: avg, pctBuenos }

  const anuncios = computeAdQuality(leads)
    .slice(0, 12)
    .map((a: AdQuality) => ({
      anuncio: a.anuncio,
      totalLeads: a.totalLeads,
      conEncuesta: a.conEncuesta,
      avgQuality: a.avgQuality,
      pctBuenos: a.pctBuenos,
      citas: a.citas,
      muestraCorta: a.muestraCorta,
      veredicto: veredictoAnuncio(a, ref),
    }))

  const hayCreativo = leads.some((l) => Boolean(l.anuncio))
  const fuentes: FuentesLanzamiento = {
    agendas: agendasLeidas && conCita.size > 0,
    ventas: ventasLeidas && conVenta.size > 0,
    meta: Boolean(cfg.META_ACCESS_TOKEN && cfg.META_AD_ACCOUNT_ID),
    tiktokAds: false,
    googleAds: false,
    nutricionEmail: false,
    nutricionWhatsapp: false,
    asistenciaEvento: false,
    creativoOrigen: hayCreativo,
    encuesta: conEncuesta.length > 0,
  }

  const embudo = construirEmbudo({
    registrados: totalReal ?? lista.length,
    confirmados,
    invitados,
    agendados: agendasLeidas ? conCita.size : null,
    asistieron: agendasLeidas ? asistieron.size : null,
    ventas: ventasLeidas ? conVenta.size : null,
  })
  const frenosDist = distribucion(frenos)
  const faltan = datosQueFaltan(fuentes)

  return {
    lanzamiento: { id: lanz.id as string, label: lanz.label as string, fecha: lanz.fecha as string },
    muestraCompleta: (totalReal ?? 0) <= MAX_FILAS,
    registrados: totalReal ?? lista.length,
    conEncuesta: conEncuesta.length,
    embudo,
    anuncios,
    frenos: frenosDist,
    frases: frasesRepetidas(piden),
    faltan,
    acciones: construirAcciones({ anuncios, embudo, frenos: frenosDist, faltan }),
  }
}

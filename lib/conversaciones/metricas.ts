// MÉTRICAS OPERATIVAS DE CONVERSACIONES (puras). Miden cómo se atienden los mensajes, NO la venta: los KPIs
// comerciales (show rate, cierre…) tienen su fórmula canónica en la skill sales-engineering y no se
// redefinen aquí. Un hueco no es un cero: sin base (nadie escribió, nadie fue atendido) el valor es `null`.

export type FilaMensaje = { conversation_id: string; direction: string; author: string; sent_at: string }
export type FilaEvento = { conversation_id: string; kind: string; data: Record<string, unknown> | null }
export type FilaConversacionMetrica = { id: string; contact_id: string | null }
export type CitaPosterior = { contact_id: string | null; created_at: string }

export type MetricasConversaciones = {
  /** Conversaciones con al menos un mensaje del lead en el periodo. */
  conversaciones: number
  /** % con alguna respuesta (persona o IA) posterior al primer mensaje del lead. `null` sin conversaciones. */
  respondidas: number | null
  /** Mediana, en minutos, desde el primer mensaje del lead hasta la primera respuesta. `null` sin respondidas. */
  primeraRespuestaMin: { humano: number | null; ia: number | null }
  /** Conversaciones en las que respondió la IA al menos una vez. */
  atendidasPorIA: number
  /** % de las atendidas por IA que acabaron en traspaso a una persona. `null` si la IA no atendió ninguna. */
  traspasoPct: number | null
  motivosTraspaso: { motivo: string; n: number }[]
  borradores: { pendientes: number; aprobados: number; descartados: number }
  enviosIA: number
  /** Leads de estas conversaciones con una cita creada DESPUÉS de su primer mensaje. `null` si no se pudo comprobar. */
  agendasPosteriores: number | null
}

const mediana = (v: number[]): number | null => {
  if (v.length === 0) return null
  const o = [...v].sort((a, b) => a - b)
  const m = Math.floor(o.length / 2)
  return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2
}
const minutos = (desde: string, hasta: string) => (Date.parse(hasta) - Date.parse(desde)) / 60_000

export function calcularMetricas(
  conversaciones: readonly FilaConversacionMetrica[],
  mensajes: readonly FilaMensaje[],
  eventos: readonly FilaEvento[],
  citas: readonly CitaPosterior[] | null
): MetricasConversaciones {
  const porConv = new Map<string, FilaMensaje[]>()
  for (const m of mensajes) porConv.set(m.conversation_id, [...(porConv.get(m.conversation_id) ?? []), m])

  let activas = 0
  let respondidas = 0
  let atendidasPorIA = 0
  const tHumano: number[] = []
  const tIA: number[] = []
  const primerEntrante = new Map<string, string>()
  const atendidasIA = new Set<string>()

  for (const c of conversaciones) {
    const ms = (porConv.get(c.id) ?? []).slice().sort((a, b) => a.sent_at.localeCompare(b.sent_at))
    const primero = ms.find((m) => m.direction === 'entrante')
    if (!primero) continue
    activas++
    primerEntrante.set(c.id, primero.sent_at)
    const resp = ms.find(
      (m) => m.direction === 'saliente' && (m.author === 'humano' || m.author === 'ia') && m.sent_at >= primero.sent_at
    )
    if (resp) {
      respondidas++
      const t = minutos(primero.sent_at, resp.sent_at)
      if (Number.isFinite(t) && t >= 0) (resp.author === 'ia' ? tIA : tHumano).push(t)
    }
    if (ms.some((m) => m.author === 'ia')) {
      atendidasPorIA++
      atendidasIA.add(c.id)
    }
  }

  const traspasadas = new Set<string>()
  const motivos = new Map<string, number>()
  const b = { pendientes: 0, aprobados: 0, descartados: 0 }
  let enviosIA = 0
  for (const e of eventos) {
    if (e.kind === 'traspaso' && primerEntrante.has(e.conversation_id)) {
      // Un traspaso por señal (p. ej. «precio») sin respuesta previa de la IA también es trabajo del agente.
      traspasadas.add(e.conversation_id)
      const m = typeof e.data?.motivo === 'string' ? e.data.motivo.split(':')[0] : 'otro'
      motivos.set(m, (motivos.get(m) ?? 0) + 1)
    } else if (e.kind === 'borrador' && primerEntrante.has(e.conversation_id)) {
      const est = e.data?.estado
      if (est === 'pendiente') b.pendientes++
      else if (est === 'aprobado') b.aprobados++
      else if (est === 'descartado') b.descartados++
    } else if (e.kind === 'ia_envio' && primerEntrante.has(e.conversation_id)) enviosIA++
  }

  // Base del % de traspaso: conversaciones que el agente tocó (respondió, dejó borrador o traspasó).
  const tocadas = new Set<string>([...atendidasIA, ...traspasadas])
  for (const e of eventos)
    if (e.kind === 'borrador' && primerEntrante.has(e.conversation_id)) tocadas.add(e.conversation_id)

  let agendas: number | null = null
  if (citas) {
    const contactos = new Map<string, string>()
    for (const c of conversaciones) {
      const t = primerEntrante.get(c.id)
      if (c.contact_id && t && (!contactos.has(c.contact_id) || t < (contactos.get(c.contact_id) as string)))
        contactos.set(c.contact_id, t)
    }
    const con = new Set<string>()
    for (const cita of citas) {
      const t = cita.contact_id ? contactos.get(cita.contact_id) : undefined
      if (t && cita.created_at >= t && cita.contact_id) con.add(cita.contact_id)
    }
    agendas = con.size
  }

  return {
    conversaciones: activas,
    respondidas: activas > 0 ? (respondidas / activas) * 100 : null,
    primeraRespuestaMin: { humano: mediana(tHumano), ia: mediana(tIA) },
    atendidasPorIA,
    traspasoPct: tocadas.size > 0 ? (traspasadas.size / tocadas.size) * 100 : null,
    motivosTraspaso: [...motivos].map(([motivo, n]) => ({ motivo, n })).sort((a, b) => b.n - a.n),
    borradores: b,
    enviosIA,
    agendasPosteriores: agendas,
  }
}

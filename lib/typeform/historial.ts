import type { SupabaseClient } from '@supabase/supabase-js'
import { crearClienteTypeform, comoPayloadDeWebhook, type ClienteTypeform } from '@/lib/typeform/api'
import { procesarRespuestaTypeform } from '@/lib/typeform/entrada'
import { listaFormulariosFeedback } from '@/lib/typeform/respuesta'

// CARGA DEL HISTÓRICO DE TYPEFORM. Lee por API las respuestas anteriores al webhook y las pasa por el mismo
// motor que el webhook (`procesarRespuestaTypeform`), que las encaja con el contacto, guarda su cualificación
// y la copia a sus agendas. Idempotente (por el token de la respuesta) y reanudable por lotes: cada petición
// cabe en los 60 s de la Function y devuelve un cursor para la siguiente.
//
// NO crea contactos: encaja solo con los que ya existen. Crear con fecha antigua cientos de leads de golpe
// movería las métricas de periodos cerrados; quien no encaja queda guardado en raw_events y se cuenta aquí.

type Servicio = SupabaseClient

export type CursorHistorial = { form: string; antesDe?: string }

export type ResultadoLote = {
  procesadas: number
  encajadas: number
  sinContacto: number
  yaProcesadas: number
  errores: number
  /** Formularios recorridos por completo en esta petición. */
  formulariosCompletos: number
  formulariosTotal: number
  /** Cursor para la siguiente petición; `null` = terminado. */
  siguiente: CursorHistorial | null
}

export function codificarCursor(c: CursorHistorial): string {
  return Buffer.from(JSON.stringify(c)).toString('base64url')
}

export function decodificarCursor(valor: string | undefined | null): CursorHistorial | null {
  if (!valor) return null
  try {
    const c = JSON.parse(Buffer.from(valor, 'base64url').toString('utf8')) as CursorHistorial
    return typeof c.form === 'string' && c.form.length <= 64 ? { form: c.form, antesDe: c.antesDe } : null
  } catch {
    return null
  }
}

export async function cargarHistorialTypeform(opciones: {
  sb: Servicio
  tenantId: string
  cfg: Record<string, string>
  cursor?: CursorHistorial | null
  /** Días hacia atrás (por defecto 120). */
  dias?: number
  presupuestoMs?: number
  cliente?: ClienteTypeform
  ahora?: () => number
}): Promise<ResultadoLote> {
  const { sb, tenantId, cfg } = opciones
  const token = cfg.TYPEFORM_API_TOKEN
  if (!token && !opciones.cliente) throw new Error('Falta TYPEFORM_API_TOKEN')
  const cliente = opciones.cliente ?? crearClienteTypeform(token, { region: cfg.TYPEFORM_REGION })
  const ahora = opciones.ahora ?? Date.now
  const limite = ahora() + (opciones.presupuestoMs ?? 40_000)
  const dias = Math.min(Math.max(opciones.dias ?? 120, 1), 730)
  const desde = new Date(ahora() - dias * 86_400_000).toISOString()
  const feedback = listaFormulariosFeedback(cfg.TYPEFORM_FEEDBACK_FORMS)

  const formularios = await cliente.listarFormularios()
  const r: ResultadoLote = {
    procesadas: 0,
    encajadas: 0,
    sinContacto: 0,
    yaProcesadas: 0,
    errores: 0,
    formulariosCompletos: 0,
    formulariosTotal: formularios.length,
    siguiente: null,
  }
  let indice = opciones.cursor
    ? Math.max(
        formularios.findIndex((f) => f.id === opciones.cursor!.form),
        0
      )
    : 0
  let antesDe = opciones.cursor?.antesDe

  while (indice < formularios.length) {
    const form = formularios[indice]
    const definicion = await cliente.leerDefinicion(form.id)
    for (;;) {
      if (ahora() > limite) {
        r.siguiente = { form: form.id, antesDe }
        return r
      }
      const { items } = await cliente.leerRespuestas(form.id, { desde, antesDe })
      if (items.length === 0) break
      const tokens = items.map((i) => (typeof i.token === 'string' ? i.token : '')).filter(Boolean)
      // Lo ya normalizado no se vuelve a procesar: cada reanudación avanza en vez de repetir trabajo.
      const { data: previos } = await sb
        .from('raw_events')
        .select('source_event_id')
        .eq('tenant_id', tenantId)
        .eq('source', 'typeform')
        .eq('processing_status', 'normalized')
        .in('source_event_id', tokens)
      const hechos = new Set((previos ?? []).map((p) => (p as { source_event_id: string }).source_event_id))
      for (const item of items) {
        const tk = typeof item.token === 'string' ? item.token : ''
        if (!tk) continue
        if (hechos.has(tk)) {
          r.yaProcesadas++
          continue
        }
        const payload = comoPayloadDeWebhook(item, form.id, definicion)
        const res = await procesarRespuestaTypeform(sb, tenantId, payload, {
          formulariosFeedback: feedback,
          bytes: JSON.stringify(payload).length,
          userAgent: 'typeform-historial',
          origen: null,
          soloExistentes: true,
        })
        if (res.status >= 400) r.errores++
        else {
          r.procesadas++
          if (res.cuerpo.contacto === true) r.encajadas++
          else r.sinContacto++
        }
      }
      antesDe =
        typeof items[items.length - 1].token === 'string' ? (items[items.length - 1].token as string) : undefined
      if (items.length < 100 || !antesDe) break
    }
    r.formulariosCompletos++
    indice++
    antesDe = undefined
  }
  return r
}

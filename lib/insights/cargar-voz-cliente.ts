// Lectura de las señales de la voz del cliente desde la base (objeciones de llamadas + formularios).
// Siempre acotada a la subcuenta, con ventana de fechas y tope de filas. Un error de lectura NO se
// convierte en «cero señales»: se devuelve en `errores` para que la pantalla lo diga.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Origen, Senal } from './voz-cliente'

export const VENTANA_DIAS = 120
const TOPE_FILAS = 1000
const MIN_TEXTO = 15
const MAX_TEXTO = 600

const CATEGORIAS: Record<string, Origen> = {
  captacion: 'formulario',
  cualificacion_cliente: 'formulario',
  feedback_cliente: 'feedback',
  feedback_clase: 'feedback',
  feedback_modulo: 'feedback',
}

// Preguntas de elección que SÍ hablan de frenos aunque la respuesta sea una opción cerrada.
const TITULO_FRENO = /obst[aá]culo|freno|miedo|duda|problema|dolor|reto|frustra|te impide|te preocupa|principal desaf/i

type Pregunta = {
  id: string
  type: string
  title?: string
  semantic?: string
  options?: Array<{ value: string; label: string }>
}
type Respuesta = {
  answers: Record<string, unknown> | null
  completed_at: string | null
  form_id: string
  version_id: string
}

export type CargaSenales = {
  senales: Senal[]
  /** Nº de señales por fuente; null si esa fuente no se pudo leer. */
  fuentes: { llamadas: number | null; formularios: number | null }
  errores: string[]
  desde: string
}

const trozos = <T>(lista: T[], n: number): T[][] => {
  const r: T[][] = []
  for (let i = 0; i < lista.length; i += n) r.push(lista.slice(i, i + n))
  return r
}

/** Extrae los textos de respuesta (libres, o de elección cuando la pregunta trata de frenos) de una respuesta de formulario. */
export function textosDeRespuesta(preguntas: Pregunta[], answers: Record<string, unknown>): string[] {
  const textos: string[] = []
  for (const pregunta of preguntas) {
    if (pregunta.semantic?.startsWith('contact.')) continue
    const valor = answers[pregunta.id]
    if (pregunta.type === 'longText' || pregunta.type === 'shortText') {
      if (typeof valor === 'string') {
        const texto = valor.trim().slice(0, MAX_TEXTO)
        if (texto.length >= MIN_TEXTO) textos.push(texto)
      }
    } else if (
      (pregunta.type === 'singleChoice' || pregunta.type === 'multiChoice' || pregunta.type === 'dropdown') &&
      TITULO_FRENO.test(pregunta.title ?? '')
    ) {
      const elegidas = Array.isArray(valor) ? valor : valor === undefined ? [] : [valor]
      for (const elegida of elegidas) {
        const opcion = pregunta.options?.find((o) => o.value === elegida)
        const etiqueta = (opcion?.label ?? (typeof elegida === 'string' ? elegida : '')).trim()
        if (etiqueta.length >= 8) textos.push(etiqueta)
      }
    }
  }
  return textos
}

export async function cargarSenalesVozCliente(
  sb: SupabaseClient,
  tenantId: string,
  ahora = new Date()
): Promise<CargaSenales> {
  const desde = new Date(ahora.getTime() - VENTANA_DIAS * 864e5).toISOString()
  const senales: Senal[] = []
  const errores: string[] = []
  const fuentes: CargaSenales['fuentes'] = { llamadas: null, formularios: null }

  // 1) Objeciones detectadas por la IA en las llamadas de venta.
  const citas = await sb
    .from('appointments')
    .select('ai_analysis,ai_analyzed_at')
    .eq('tenant_id', tenantId)
    .not('ai_analysis', 'is', null)
    .gte('ai_analyzed_at', desde)
    .order('ai_analyzed_at', { ascending: false })
    .limit(TOPE_FILAS)
  if (citas.error) errores.push('No se pudieron leer las llamadas analizadas.')
  else {
    let n = 0
    for (const fila of citas.data ?? []) {
      const objeciones = (fila.ai_analysis as { objections?: unknown } | null)?.objections
      if (!Array.isArray(objeciones)) continue
      for (const o of objeciones) {
        if (typeof o !== 'string' || o.trim().length < 8) continue
        senales.push({
          origen: 'llamada',
          texto: o.trim().slice(0, MAX_TEXTO),
          fecha: fila.ai_analyzed_at ?? undefined,
        })
        n += 1
      }
    }
    fuentes.llamadas = n
  }

  // 2) Formularios de aplicación (antes de la llamada) y de feedback.
  const formularios = await sb
    .from('forms')
    .select('id,category')
    .eq('tenant_id', tenantId)
    .in('category', Object.keys(CATEGORIAS))
  if (formularios.error) errores.push('No se pudieron leer los formularios.')
  else {
    const categoriaDe = new Map((formularios.data ?? []).map((f) => [f.id as string, f.category as string]))
    const ids = [...categoriaDe.keys()]
    if (!ids.length) fuentes.formularios = 0
    else {
      const respuestas = await sb
        .from('form_responses')
        .select('answers,completed_at,form_id,version_id')
        .eq('tenant_id', tenantId)
        .eq('status', 'completed')
        .in('form_id', ids)
        .gte('completed_at', desde)
        .order('completed_at', { ascending: false })
        .limit(TOPE_FILAS)
      if (respuestas.error) errores.push('No se pudieron leer las respuestas de formularios.')
      else {
        const filas = (respuestas.data ?? []) as Respuesta[]
        const versiones = new Map<string, Pregunta[]>()
        let fallo = false
        for (const lote of trozos([...new Set(filas.map((f) => f.version_id))], 100)) {
          const lectura = await sb.from('form_versions').select('id,config').eq('tenant_id', tenantId).in('id', lote)
          if (lectura.error) {
            fallo = true
            break
          }
          for (const v of lectura.data ?? [])
            versiones.set(
              v.id as string,
              ((v.config as { questions?: Pregunta[] } | null)?.questions ?? []) as Pregunta[]
            )
        }
        if (fallo) errores.push('No se pudieron leer las preguntas de los formularios.')
        else {
          let n = 0
          for (const fila of filas) {
            const origen = CATEGORIAS[categoriaDe.get(fila.form_id) ?? '']
            const preguntas = versiones.get(fila.version_id)
            if (!origen || !preguntas || !fila.answers) continue
            for (const texto of textosDeRespuesta(preguntas, fila.answers)) {
              senales.push({ origen, texto, fecha: fila.completed_at ?? undefined })
              n += 1
            }
          }
          fuentes.formularios = n
        }
      }
    }
  }
  return { senales, fuentes, errores, desde }
}

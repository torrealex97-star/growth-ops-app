import { temasDeTexto, TEMAS } from '@/lib/insights/voz-cliente'

// BRIEFING AL CLOSER: lo que conviene saber de la persona antes de la llamada y qué palancas tocar.
// Núcleo PURO y determinista: parte solo de lo que la persona contestó, del anuncio de origen y de lo
// que se detectó en llamadas anteriores. No inventa: si una sección no tiene dato, no se pinta.

export type EntradaBriefing = {
  /** Pares pregunta/respuesta del formulario previo a la llamada. */
  respuestas: { pregunta: string; respuesta: string }[]
  /** Anuncio o creativo de origen (utm_content), si se conoce. */
  anuncio?: string | null
  campana?: string | null
  /** Objeciones detectadas en llamadas anteriores con esta persona. */
  objecionesPrevias?: string[]
  /** Puntuación de lead (0-100) y su nivel, ya calculados por el CRM. */
  leadNivel?: 'alto' | 'medio' | 'bajo' | 'sin_datos' | null
}

export type PalancaBriefing = { tema: string; temaId: string; palanca: string; porQue: string }

export type Briefing = {
  angulo: { anuncio: string | null; campana: string | null }
  situacion: { pregunta: string; respuesta: string }[]
  temas: { id: string; label: string }[]
  palancas: PalancaBriefing[]
  objeccionesPrevias: string[]
  leadNivel: EntradaBriefing['leadNivel']
  /** false si no hay nada que mostrar (ni respuestas ni origen ni historial). */
  conDatos: boolean
}

/** Qué tocar en la llamada según el tema que aparece en lo que la persona escribió. */
export const PALANCAS: Record<string, string> = {
  dinero:
    'Cuantificar lo que le cuesta seguir igual y revisar opciones de pago antes de dar el precio; no defender el precio, anclarlo al resultado.',
  tiempo:
    'Enseñar el plan mínimo semanal (cuántas horas reales) y qué se puede quitar de su agenda; preguntar qué haría con ese tiempo si lo tuviera.',
  confianza:
    'Abrir con casos reales parecidos a su situación, con lo bueno y lo malo, y explicar la garantía; dejar que pregunte lo que quiera sobre el método.',
  capacidad:
    'Normalizar el miedo, contar qué hace en la primera semana y quién le acompaña; pedirle un ejemplo de algo difícil que ya haya logrado.',
  claridad: 'Dibujarle el camino paso a paso desde donde está hoy hasta su primer resultado; no abrumar con opciones.',
  clientes:
    'Preguntar cómo consigue clientes hoy y qué cifra necesita; conectar el programa con su método de captación.',
  libertad:
    'Preguntar qué cambiaría en su día a día sin jefe y qué le ata hoy al empleo; plantear la transición sin jugarse el sueldo.',
  familia: 'Preguntar por quién lo hace y qué cambiaría en casa; implicar a la pareja si la decisión es compartida.',
  fracaso_previo:
    'Preguntar qué probó y por qué cree que no funcionó; mostrar qué es distinto esta vez en lugar de prometer más.',
}

const limpio = (s: string | null | undefined) => (s ?? '').trim()

export function construirBriefing(e: EntradaBriefing): Briefing {
  const situacion = e.respuestas
    .map((r) => ({ pregunta: limpio(r.pregunta), respuesta: limpio(r.respuesta) }))
    .filter((r) => r.pregunta && r.respuesta)
    .slice(0, 12)

  const textos = [...situacion.map((r) => r.respuesta), ...(e.objecionesPrevias ?? [])]
  const ids = new Set<string>()
  for (const t of textos) for (const id of temasDeTexto(t)) ids.add(id)
  const temas = TEMAS.filter((t) => ids.has(t.id)).map((t) => ({ id: t.id, label: t.label }))

  const palancas: PalancaBriefing[] = temas
    .filter((t) => PALANCAS[t.id])
    .map((t) => ({
      tema: t.label,
      temaId: t.id,
      palanca: PALANCAS[t.id],
      porQue: (e.objecionesPrevias ?? []).some((o) => temasDeTexto(o).includes(t.id))
        ? 'Ya apareció como objeción en una llamada anterior.'
        : 'Aparece en lo que escribió en el formulario.',
    }))

  const anuncio = limpio(e.anuncio) || null
  const campana = limpio(e.campana) || null
  const objeccionesPrevias = (e.objecionesPrevias ?? []).map(limpio).filter(Boolean).slice(0, 6)
  return {
    angulo: { anuncio, campana },
    situacion,
    temas,
    palancas,
    objeccionesPrevias,
    leadNivel: e.leadNivel ?? null,
    conDatos: Boolean(situacion.length || anuncio || campana || objeccionesPrevias.length),
  }
}

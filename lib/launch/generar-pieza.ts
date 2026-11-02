import type { SupabaseClient } from '@supabase/supabase-js'
import { completeText } from '@/lib/ai/provider'
import { geminiGenerar } from '@/lib/ai/gemini'
import { openaiChat } from '@/lib/ai/openai'
import { elegirMotorTexto, modeloTexto } from '@/lib/carruseles/motor'
import type { Canal } from './contenido'

// Generación con IA de UNA pieza del calendario a partir del guion del webinar. El guion es la
// fuente: todo el contenido del lanzamiento debe repetir la misma creencia que se vende en el
// directo. La sugerencia NO se guarda sola: la persona decide si la usa (quien publica responde de
// lo que sale con su nombre).

export const MAX_GUION = 60_000
/** Cuánto guion se manda al modelo: suficiente para la historia entera sin disparar el coste. */
const MAX_GUION_PROMPT = 24_000

const FORMATO_POR_CANAL: Record<Canal, string> = {
  email:
    'Un email: primera línea «Asunto: …» (curioso, sin clichés de manual) y después el cuerpo en párrafos cortos con un único enlace de acción.',
  whatsapp: 'Un mensaje de grupo de WhatsApp: máximo 6 líneas, tono cercano, una sola idea y una acción clara.',
  encuesta:
    'Una encuesta del grupo: la pregunta en la primera línea y una opción por línea empezando por «- » (de 2 a 4 opciones).',
  winners: 'Un mensaje corto de bienvenida a quienes acaban de entrar, celebrando el paso y diciendo qué hacer ahora.',
  grabar:
    'El guion de un vídeo corto a grabar: gancho (primeros 3 segundos), desarrollo en 3 o 4 frases y cierre con una invitación.',
  stories: 'Una tanda de 4 a 6 stories numeradas; en cada una, el texto en pantalla y una nota de qué enseñar.',
  reel: 'Un guion de reel: gancho de 3 segundos, desarrollo en frases cortas y cierre con llamada a la acción.',
  post: 'El texto de un post o pie de carrusel: gancho en la primera línea, desarrollo breve y cierre con invitación.',
  directo: 'El esquema de un directo o emisión: apertura, 3 o 4 bloques con el tiempo de cada uno y cierre.',
  otro: 'Un texto breve adecuado a la pieza, listo para publicar.',
}

export type EntradaPrompt = {
  guion: string
  pieza: { canal: Canal; titulo: string; texto: string | null; dia: number | null }
  lanzamiento: { label: string; fecha: string }
}

const SISTEMA = `Eres el copywriter del equipo. Escribes en español de España, con tono directo, cercano y sin humo.
Reglas:
- El guion del webinar es la FUENTE. Repite su única creencia y su forma de hablar; no inventes otra historia.
- Revela el QUÉ y el POR QUÉ, nunca el CÓMO completo: el cómo se enseña en el directo.
- No inventes cifras, resultados, testimonios, plazas ni descuentos que no estén en el guion o en la indicación de la pieza.
- No prometas ingresos ni resultados garantizados.
- Devuelve SOLO el texto de la pieza, listo para pegar. Sin explicaciones ni comillas alrededor.`

export function construirPrompt(e: EntradaPrompt): { system: string; user: string } {
  const cuando =
    e.pieza.dia == null
      ? 'sin día fijado'
      : e.pieza.dia === 0
        ? 'el día del evento'
        : e.pieza.dia < 0
          ? `${-e.pieza.dia} días antes del evento`
          : `${e.pieza.dia} días después del evento`
  const guion = e.guion.trim().slice(0, MAX_GUION_PROMPT)
  const user = [
    `Lanzamiento: ${e.lanzamiento.label} (evento el ${e.lanzamiento.fecha}).`,
    `Pieza: «${e.pieza.titulo}», ${cuando}.`,
    e.pieza.texto?.trim() ? `Indicación de lo que toca en esta pieza: ${e.pieza.texto.trim()}` : '',
    `Formato: ${FORMATO_POR_CANAL[e.pieza.canal] ?? FORMATO_POR_CANAL.otro}`,
    '',
    'GUION DEL WEBINAR (fuente):',
    '<<<',
    guion,
    '>>>',
  ]
    .filter((l) => l !== '')
    .join('\n')
  return { system: SISTEMA, user }
}

type Cfg = Record<string, string | undefined>

/** Una petición de texto con el motor que tenga clave: Anthropic/Gemini/OpenAI y, si no, DeepSeek/Groq. */
export async function generarTexto(
  cfg: Cfg,
  p: { system: string; user: string },
  inyectado: { completeText?: typeof completeText; gemini?: typeof geminiGenerar; openai?: typeof openaiChat } = {}
): Promise<{ texto: string; motor: string }> {
  const motor = elegirMotorTexto(cfg)
  if (motor === 'gemini') {
    const r = await (inyectado.gemini ?? geminiGenerar)({
      apiKey: cfg.GEMINI_API_KEY as string,
      model: modeloTexto(cfg, 'gemini'),
      system: p.system,
      contents: [{ role: 'user', parts: [{ text: p.user }] }],
      maxTokens: 2000,
    })
    return { texto: r.texto, motor: 'gemini' }
  }
  if (motor === 'openai') {
    const r = await (inyectado.openai ?? openaiChat)({
      apiKey: cfg.OPENAI_API_KEY as string,
      model: modeloTexto(cfg, 'openai'),
      messages: [
        { role: 'system', content: p.system },
        { role: 'user', content: p.user },
      ],
      maxTokens: 2000,
    })
    return { texto: r.texto, motor: 'openai' }
  }
  // Anthropic u otro motor de texto de la subcuenta (DeepSeek, Groq): el proveedor común decide.
  const r = await (inyectado.completeText ?? completeText)({ ...p, maxTokens: 2000, smart: true }, cfg)
  return { texto: r.text, motor: r.engine }
}

/** Genera la sugerencia para una pieza. Devuelve el texto; NO lo guarda. */
export async function generarPieza(
  sb: SupabaseClient,
  tenantId: string,
  piezaId: string,
  cfg: Cfg,
  inyectado?: Parameters<typeof generarTexto>[2]
): Promise<{ texto: string; motor: string }> {
  const { data: pieza } = await sb
    .from('launch_content')
    .select('launch_id, canal, titulo, texto, dia')
    .eq('tenant_id', tenantId)
    .eq('id', piezaId)
    .maybeSingle()
  if (!pieza) throw new Error('Pieza no encontrada')
  const p = pieza as { launch_id: string; canal: Canal; titulo: string; texto: string | null; dia: number | null }
  const { data: lanz } = await sb
    .from('launches')
    .select('label, fecha, guion_webinar')
    .eq('tenant_id', tenantId)
    .eq('id', p.launch_id)
    .maybeSingle()
  if (!lanz) throw new Error('Lanzamiento no encontrado')
  const l = lanz as { label: string; fecha: string; guion_webinar: string | null }
  if (!l.guion_webinar?.trim()) throw new Error('Pega primero el guion del webinar: es la fuente de todo el contenido')
  const prompt = construirPrompt({ guion: l.guion_webinar, pieza: p, lanzamiento: l })
  const r = await generarTexto(cfg, prompt, inyectado)
  const texto = r.texto.trim()
  if (!texto) throw new Error('La IA no devolvió texto. Inténtalo de nuevo.')
  return { texto, motor: r.motor }
}

export async function leerGuion(sb: SupabaseClient, tenantId: string, launchId: string): Promise<string | null> {
  const { data, error } = await sb
    .from('launches')
    .select('guion_webinar')
    .eq('tenant_id', tenantId)
    .eq('id', launchId)
    .maybeSingle()
  // Si la columna aún no existe (migración sin aplicar) la pantalla sigue funcionando sin guion.
  if (error || !data) return null
  return (data as { guion_webinar: string | null }).guion_webinar
}

export async function guardarGuion(
  sb: SupabaseClient,
  tenantId: string,
  launchId: string,
  guion: string
): Promise<void> {
  if (guion.length > MAX_GUION)
    throw new Error(`El guion es demasiado largo (máximo ${MAX_GUION.toLocaleString('es-ES')} caracteres)`)
  const { data, error } = await sb
    .from('launches')
    .update({ guion_webinar: guion.trim() || null })
    .eq('tenant_id', tenantId)
    .eq('id', launchId)
    .select('id')
    .maybeSingle()
  if (error) throw new Error(`No se pudo guardar el guion: ${error.message}`)
  if (!data) throw new Error('Lanzamiento no encontrado')
}

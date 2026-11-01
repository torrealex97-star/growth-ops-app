// VOZ DEL CLIENTE: qué dicen los clientes potenciales (formulario previo a la llamada, objeciones en
// la llamada de ventas) y qué dicen los clientes (feedback, onboarding, objeciones que tuvieron antes
// de comprar). Núcleo PURO: sin red ni base de datos.
//
// Reglas de rigor: (1) cada porcentaje lleva su n y su base; (2) se cuentan PERSONAS, no menciones
// (quien lo repite diez veces pesa como quien lo dice una); (3) lo que no encaja en ningún tema se
// declara como «Otros» y, si pasa del 20 %, se avisa de que la clasificación se queda corta;
// (4) las citas literales van anonimizadas; (5) las ideas de contenido salen de un tema con cifra.

export type Grupo = 'potenciales' | 'clientes'
export type Origen = 'formulario_previo' | 'llamada_ventas' | 'feedback'

export type Fragmento = {
  /** Identificador de persona dentro de la subcuenta (no se muestra). */
  persona: string
  grupo: Grupo
  origen: Origen
  texto: string
}

export type Tema = { id: string; label: string; re: RegExp }

/** Taxonomía base: dolores, miedos y deseos habituales de quien compra una formación o servicio. */
export const TEMAS: readonly Tema[] = [
  {
    id: 'dinero',
    label: 'El dinero no alcanza o el precio frena',
    re: /dinero|precio|caro|cuesta|econom|ingres|deud|pagar|inversi[oó]n|presupuesto|cobrar|fin de mes|no llego/,
  },
  {
    id: 'tiempo',
    label: 'No tengo tiempo',
    re: /tiempo|horas|ocupad|agenda|trabajo mucho|no me da la vida|compagin|disponibilidad/,
  },
  {
    id: 'confianza',
    label: 'Desconfianza: miedo a que sea humo o estafa',
    re: /estafa|humo|fiar|conf[ií]o|confianza|garant[ií]a|enga[nñ]|vendehumo|otro curso|funcione de verdad|es real/,
  },
  {
    id: 'capacidad',
    label: 'Miedo a no ser capaz',
    re: /no (voy a )?(sea|ser|sabr[eé]|podr[eé]|consigo|logro)|capaz|miedo|inseguridad|no valgo|no s[eé] nada|soy mayor|sin experiencia/,
  },
  {
    id: 'claridad',
    label: 'No sé por dónde empezar',
    re: /por d[oó]nde empez|no s[eé] c[oó]mo|no tengo claro|perdid|desorient|paso a paso|gu[ií]a|orden/,
  },
  {
    id: 'clientes',
    label: 'Conseguir clientes y vender',
    re: /client|vender|ventas|captar|prospec|facturar|negocio|leads/,
  },
  {
    id: 'libertad',
    label: 'Libertad: dejar de depender de un jefe o empleo',
    re: /jefe|empleo|n[oó]mina|libertad|independ|depender|trabajo por cuenta|mi propio negocio|emprender/,
  },
  {
    id: 'familia',
    label: 'Dar una mejor vida a la familia',
    re: /familia|hij[oa]s?|pareja|mujer|marido|padres|casa|hipoteca/,
  },
  {
    id: 'fracaso_previo',
    label: 'Ya lo intenté y no funcionó',
    re: /ya (lo )?(prob|intent)|no (me )?funcion|fracas|otras formaciones|he probado|sin resultados/,
  },
]

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim()

/** Temas (ids) que menciona un texto; vacío si no encaja en ninguno. */
export function temasDeTexto(texto: string): string[] {
  const s = norm(texto)
  if (s.replace(/[^a-z]/g, '').length < 4) return []
  return TEMAS.filter((t) => t.re.test(s)).map((t) => t.id)
}

/** Quita lo que identifica a una persona y acorta. Devuelve null si no queda una frase útil. */
export function anonimizar(texto: string, max = 160): string | null {
  const limpio = texto
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]')
    .replace(/https?:\/\/\S+|www\.\S+/g, '[enlace]')
    .replace(/@\w{2,}/g, '[usuario]')
    .replace(/\+?\d[\d\s().-]{6,}\d/g, '[número]')
    .replace(/\s+/g, ' ')
    .trim()
  if (limpio.replace(/[^\p{L}]/gu, '').length < 8) return null
  if (limpio.length <= max) return limpio
  const corte = limpio.slice(0, max)
  return `${corte.slice(0, Math.max(corte.lastIndexOf(' '), 40))}…`
}

export type TemaMedido = {
  id: string
  label: string
  personas: number
  pct: number
  /** Citas literales anonimizadas de personas distintas (solo si se piden). */
  citas: string[]
}

export type VozGrupo = {
  grupo: Grupo
  /** Personas distintas con algún texto analizado. */
  base: number
  porOrigen: Record<Origen, number>
  temas: TemaMedido[]
  otros: { personas: number; pct: number; avisoClasificacion: boolean }
}

const redondeo = (x: number) => Math.round(x * 10) / 10

export function analizarVoz(fragmentos: Fragmento[], opciones: { conCitas?: boolean; maxCitas?: number } = {}) {
  const maxCitas = opciones.maxCitas ?? 3
  const out: Record<Grupo, VozGrupo> = {
    potenciales: vacio('potenciales'),
    clientes: vacio('clientes'),
  }
  for (const grupo of ['potenciales', 'clientes'] as const) {
    const del = fragmentos.filter((f) => f.grupo === grupo && f.texto.trim())
    const personas = new Set(del.map((f) => f.persona))
    const porOrigen: Record<Origen, Set<string>> = {
      formulario_previo: new Set(),
      llamada_ventas: new Set(),
      feedback: new Set(),
    }
    const porTema = new Map<string, { personas: Set<string>; citas: Map<string, string> }>()
    const conTema = new Set<string>()
    for (const f of del) {
      porOrigen[f.origen].add(f.persona)
      for (const id of temasDeTexto(f.texto)) {
        conTema.add(f.persona)
        const e = porTema.get(id) ?? { personas: new Set<string>(), citas: new Map<string, string>() }
        e.personas.add(f.persona)
        if (opciones.conCitas && !e.citas.has(f.persona) && e.citas.size < maxCitas) {
          const c = anonimizar(f.texto)
          if (c) e.citas.set(f.persona, c)
        }
        porTema.set(id, e)
      }
    }
    const base = personas.size
    const temas: TemaMedido[] = TEMAS.filter((t) => porTema.has(t.id))
      .map((t) => {
        const e = porTema.get(t.id)!
        return {
          id: t.id,
          label: t.label,
          personas: e.personas.size,
          pct: base ? redondeo((e.personas.size / base) * 100) : 0,
          citas: [...e.citas.values()],
        }
      })
      .sort((a, b) => b.personas - a.personas)
    const sinTema = base - conTema.size
    const pctOtros = base ? redondeo((sinTema / base) * 100) : 0
    out[grupo] = {
      grupo,
      base,
      porOrigen: {
        formulario_previo: porOrigen.formulario_previo.size,
        llamada_ventas: porOrigen.llamada_ventas.size,
        feedback: porOrigen.feedback.size,
      },
      temas,
      otros: { personas: sinTema, pct: pctOtros, avisoClasificacion: base >= 10 && pctOtros >= 20 },
    }
  }
  return out
}

function vacio(grupo: Grupo): VozGrupo {
  return {
    grupo,
    base: 0,
    porOrigen: { formulario_previo: 0, llamada_ventas: 0, feedback: 0 },
    temas: [],
    otros: { personas: 0, pct: 0, avisoClasificacion: false },
  }
}

// ── Ideas de contenido ─────────────────────────────────────────────────────────

export type Idea = {
  tema: string
  grupo: Grupo
  formato: 'carrusel' | 'reel' | 'email' | 'historia'
  titulo: string
  gancho: string
  /** La cifra que justifica la idea. */
  dato: string
}

const PLANTILLAS: Record<string, { titulo: string; gancho: string; formato: Idea['formato'] }[]> = {
  dinero: [
    {
      titulo: 'Cuánto cuesta NO resolverlo',
      gancho: 'Lo caro no es pagar por la solución: es seguir un año más con el mismo problema.',
      formato: 'carrusel',
    },
    {
      titulo: 'Cómo pagar menos y arriesgar menos',
      gancho: 'Las 3 formas de empezar sin comprometer tu economía.',
      formato: 'reel',
    },
  ],
  tiempo: [
    {
      titulo: 'Con 30 minutos al día',
      gancho: 'Lo mínimo que necesitas para avanzar si no tienes tiempo.',
      formato: 'reel',
    },
    {
      titulo: 'Tu semana real, sin excusas',
      gancho: 'Dónde se va el tiempo y cómo recuperar 5 horas.',
      formato: 'carrusel',
    },
  ],
  confianza: [
    {
      titulo: 'Cómo distinguir una oferta real de humo',
      gancho: 'Cinco señales antes de comprar cualquier formación.',
      formato: 'carrusel',
    },
    {
      titulo: 'Resultados con nombre y apellido',
      gancho: 'Casos reales, con lo bueno y lo malo.',
      formato: 'historia',
    },
  ],
  capacidad: [
    {
      titulo: 'No hace falta ser experto',
      gancho: 'Empezaron sin experiencia: esto es lo que hicieron la primera semana.',
      formato: 'reel',
    },
    {
      titulo: 'El miedo a no ser capaz',
      gancho: 'Lo que sientes en el día 1 es normal; esto cambia en el día 14.',
      formato: 'email',
    },
  ],
  claridad: [
    {
      titulo: 'El primer paso, sin rodeos',
      gancho: 'Si no sabes por dónde empezar, empieza por esto.',
      formato: 'carrusel',
    },
    { titulo: 'Mapa en 5 pasos', gancho: 'De cero a tu primer resultado, ordenado.', formato: 'reel' },
  ],
  clientes: [
    {
      titulo: 'Cómo conseguir tus primeros clientes',
      gancho: 'El método más corto que hemos visto funcionar.',
      formato: 'carrusel',
    },
    {
      titulo: 'Qué decir en la primera conversación',
      gancho: 'El guion de venta que no suena a venta.',
      formato: 'reel',
    },
  ],
  libertad: [
    {
      titulo: 'Dejar de depender de una nómina',
      gancho: 'Cómo se prepara la salida sin jugarte el sueldo.',
      formato: 'carrusel',
    },
    {
      titulo: 'Un día cualquiera siendo tu propio jefe',
      gancho: 'Lo bueno y lo que nadie cuenta.',
      formato: 'historia',
    },
  ],
  familia: [
    {
      titulo: 'Para quien lo hace por su familia',
      gancho: 'Lo que cambia en casa cuando cambia tu situación.',
      formato: 'reel',
    },
    {
      titulo: 'Cómo explicárselo a tu pareja',
      gancho: 'La conversación que conviene tener antes de decidir.',
      formato: 'email',
    },
  ],
  fracaso_previo: [
    {
      titulo: 'Por qué lo anterior no funcionó',
      gancho: 'No era culpa tuya: esto es lo que faltaba.',
      formato: 'carrusel',
    },
    { titulo: 'La diferencia esta vez', gancho: 'Qué hacemos distinto para que no vuelva a pasar.', formato: 'email' },
  ],
}

/** Ideas ordenadas por peso del tema. Solo de temas con al menos `minPersonas` y base suficiente. */
export function ideasDeContenido(
  voz: Record<Grupo, VozGrupo>,
  opciones: { minPersonas?: number; porGrupo?: number } = {}
): Idea[] {
  const minPersonas = opciones.minPersonas ?? 3
  const porGrupo = opciones.porGrupo ?? 4
  const ideas: Idea[] = []
  for (const grupo of ['potenciales', 'clientes'] as const) {
    const g = voz[grupo]
    for (const t of g.temas.filter((x) => x.personas >= minPersonas).slice(0, porGrupo)) {
      const plantillas = PLANTILLAS[t.id]
      if (!plantillas) continue
      const dato = `${t.personas} de ${g.base} ${grupo === 'potenciales' ? 'clientes potenciales' : 'clientes'} (${t.pct}%) lo mencionan.`
      const [p] = plantillas
      ideas.push({ tema: t.label, grupo, formato: p.formato, titulo: p.titulo, gancho: p.gancho, dato })
      if (plantillas[1] && t.pct >= 25)
        ideas.push({
          tema: t.label,
          grupo,
          formato: plantillas[1].formato,
          titulo: plantillas[1].titulo,
          gancho: plantillas[1].gancho,
          dato,
        })
    }
  }
  return ideas
}
